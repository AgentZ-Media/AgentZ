import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  on,
  onMount,
  untrack,
} from "solid-js";
import { api } from "../../lib/api";
import { foldersBus } from "../../lib/foldersBus";
import { scriptsBus } from "../../lib/scriptsBus";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { tryParseConnectCode } from "../../lib/handoff";
import { K, isModKey } from "../../lib/keys";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { settingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toasts";
import { localeCompare, t, tPlural } from "../../i18n";
import type { Folder, Idea, ScriptStatus, ScriptSummary } from "../../lib/types";
import { SCRIPT_STATUSES } from "../../lib/types";
import { Icon } from "../Common/Icon";
import { StageGlyph } from "../Common/StageGlyph";
import { confirmDialog } from "../Common/ConfirmDialog";
import { HandoffDialog } from "../Library/HandoffDialog";
import { PageBar } from "../Library/PageBar";
import { ContextMenu, type ContextMenuItem } from "../Library/ContextMenu";
import { PromptDialog } from "../Library/PromptDialog";
import { SelectionBar } from "../Library/SelectionBar";
import { SelectAllLine, SelectCheck } from "../Library/SelectCheck";
import { checkState, rangeBetween, toggleIds, withIds } from "../Library/selection";
import { createFolder } from "../Library/actions";
import { folderColor } from "./folderColor";
import {
  countNewThisWeek,
  folderCounts,
  groupIdeas,
  groupLabel,
  ideaAge,
  inFolder,
  scopeIdeas,
  sortIdeas,
  type IdeaGroup,
  type IdeaSort,
} from "./ideaGroups";
import { SortMenu } from "./parts/SortMenu";
import { IdeaDetail, type IdeaDetailHandle } from "./parts/IdeaDetail";
import "./IdeasPage.css";

/** Rows rendered per page across all open groups; "Weitere laden" adds
 *  another page. Keeps the DOM small for very large idea collections. */
const PAGE_SIZE = 50;

// Session-level view state: survives leaving and re-entering the page.
const [sort, setSort] = createSignal<IdeaSort>("newest");
const [showUsed, setShowUsed] = createSignal(false);
const [query, setQuery] = createSignal("");
/** Explicit open/closed state per group id; default: "older" closed. */
const [groupOpen, setGroupOpen] = createSignal<Record<string, boolean>>({});
/** How many rows (across open groups, in display order) are rendered. */
const [rowLimit, setRowLimit] = createSignal(PAGE_SIZE);

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

/** The ideas page (route `{ kind: "ideas", folderId? }`): capture field,
 *  folder chips, dense time-grouped list and the detail panel. */
export function IdeasPage() {
  const ideas = () => ideasStore.ideas() ?? [];
  const [folders] = createResource(() => foldersBus.version(), () => api.listFolders(), {
    initialValue: [] as Folder[],
  });
  const [scripts] = createResource(
    () => scriptsBus.version(),
    async () => {
      try {
        const list = await api.listScripts({ limit: 1000 });
        return new Map(list.map((s) => [s.id, s]));
      } catch {
        return new Map<string, ScriptSummary>();
      }
    },
    { initialValue: new Map<string, ScriptSummary>() },
  );

  // Ticking clock for the age column + the week grouping.
  const [now, setNow] = createSignal(Date.now());
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));

  // ---- folder filter (lives in the route, so ‹ › walks through it) ----
  const activeFolder = createMemo<string | null>(() => {
    const r = navStore.route();
    const id = r.kind === "ideas" ? r.folderId ?? null : null;
    if (id === null || id === INBOX_FOLDER_ID) return id;
    // A deleted folder falls back to "all".
    return (folders() ?? []).some((f) => f.id === id) || folders.loading ? id : null;
  });
  const setFolder = (id: string | null) => {
    if (id === activeFolder()) return;
    navStore.openIdeas(id);
  };
  const folderName = (id: string | null) =>
    id ? (folders() ?? []).find((f) => f.id === id)?.name ?? "" : t("ideasPage.folder.none");

  // ---- derived lists ----
  const scoped = createMemo(() => scopeIdeas(ideas(), { query: query(), showUsed: showUsed() }));
  const counts = createMemo(() => folderCounts(scoped()));
  const visible = createMemo(() => sortIdeas(inFolder(scoped(), activeFolder()), sort(), localeCompare));
  const groups = createMemo(() => groupIdeas(visible(), sort(), new Date(now())));
  const openCount = createMemo(() => ideas().filter((i) => !i.used_at).length);
  const freshCount = createMemo(() => countNewThisWeek(ideas(), new Date(now())));
  const chipFolders = createMemo(() =>
    (folders() ?? []).filter((f) => (counts().byFolder.get(f.id) ?? 0) > 0 || f.id === activeFolder()),
  );

  const filtering = () => query().trim().length > 0;
  const isOpen = (g: IdeaGroup<Idea>) => {
    if (filtering()) return true;
    const explicit = groupOpen()[g.id];
    return explicit ?? g.kind !== "older";
  };
  /** Splits the row budget over the open groups in display order. Groups
   *  after the one where the budget runs out are not rendered at all; the
   *  "load more" button below the list continues from there. */
  const paging = createMemo(() => {
    const shown = new Map<string, Idea[]>();
    const rendered: IdeaGroup<Idea>[] = [];
    let budget = rowLimit();
    let remaining = 0;
    for (const g of groups()) {
      if (budget <= 0) {
        if (isOpen(g)) remaining += g.items.length;
        continue;
      }
      rendered.push(g);
      if (!isOpen(g)) continue;
      const take = g.items.slice(0, budget);
      shown.set(g.id, take);
      budget -= take.length;
      remaining += g.items.length - take.length;
    }
    return { shown, rendered, remaining };
  });
  const shownItems = (g: IdeaGroup<Idea>) => paging().shown.get(g.id) ?? [];
  // A new folder / filter / sort starts again at the first page.
  createEffect(on([activeFolder, query, sort, showUsed], () => setRowLimit(PAGE_SIZE), { defer: true }));
  /** Row ids in display order (only rows actually rendered). */
  const visibleIds = createMemo(() => {
    const ids: string[] = [];
    for (const g of groups()) {
      if (!isOpen(g)) continue;
      for (const i of shownItems(g)) ids.push(i.id);
    }
    return ids;
  });

  // ---- selection ----
  // Outside the selection mode `selected` is just the primary (detail) row.
  // The selection mode (button, ⌘A, ⌘/⇧-click) shows checkboxes: clicks
  // toggle rows, `primary` only decides what the detail panel shows.
  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [primary, setPrimary] = createSignal<string | null>(null);
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [wanted, setWanted] = createSignal<string | null>(null);
  const [handoffOpen, setHandoffOpen] = createSignal(false);
  let detail: IdeaDetailHandle | null = null;
  let listRef: HTMLDivElement | undefined;
  let captureRef: HTMLInputElement | undefined;
  let filterRef: HTMLInputElement | undefined;

  const primaryIdea = () => {
    const id = primary();
    return id ? ideas().find((i) => i.id === id) ?? null : null;
  };

  function selectOnly(id: string | null, scroll = false) {
    setPrimary(id);
    setAnchor(id);
    setSelected(new Set(id ? [id] : []));
    if (scroll && id) {
      queueMicrotask(() => document.getElementById(`idea-row-${id}`)?.scrollIntoView({ block: "nearest" }));
    }
  }

  /** What "select all" covers: every idea of the current view (beyond the
   *  loaded page too), except groups that are collapsed. */
  const selectableIds = createMemo(() => {
    const ids: string[] = [];
    for (const g of groups()) if (isOpen(g)) for (const i of g.items) ids.push(i.id);
    return ids;
  });
  const allState = () => checkState(selectableIds(), selected());

  function enterSelectMode(initial: Iterable<string> = []) {
    setSelectMode(true);
    setSelected(new Set(initial));
  }
  function exitSelectMode() {
    setSelectMode(false);
    selectOnly(primary() ?? visibleIds()[0] ?? null);
  }
  const selectAll = () => enterSelectMode(selectableIds());
  const toggleAll = () => (allState() === "all" ? setSelected(new Set<string>()) : selectAll());

  // A different folder starts without a selection, like the scripts page.
  createEffect(
    on(
      activeFolder,
      () => {
        if (selectMode()) exitSelectMode();
      },
      { defer: true },
    ),
  );

  // Keep a valid selection: follow a wanted idea (freshly created, or
  // revealed via palette / similar link) once it shows up, otherwise fall
  // back to the first visible row.
  createEffect(() => {
    const ids = visibleIds();
    const want = wanted();
    if (want) {
      if (ids.includes(want)) {
        setWanted(null);
        setSelectMode(false);
        selectOnly(want, true);
        return;
      }
      const g = groups().find((gr) => gr.items.some((i) => i.id === want));
      if (g) {
        // In a collapsed group or beyond the loaded page: open the group
        // and extend the page so the row renders; the next run selects it.
        if (!isOpen(g)) {
          setGroupOpen({ ...groupOpen(), [g.id]: true });
          return;
        }
        if (!shownItems(g).some((i) => i.id === want)) {
          let index = 0;
          for (const gr of groups()) {
            if (gr === g) {
              index += gr.items.findIndex((i) => i.id === want);
              break;
            }
            if (isOpen(gr)) index += gr.items.length;
          }
          setRowLimit(Math.max(rowLimit(), Math.ceil((index + 1) / PAGE_SIZE) * PAGE_SIZE));
        }
        return;
      }
      if (ideas().some((i) => i.id === want)) setWanted(null); // hidden by a filter
      else return; // not loaded yet
    }
    const p = primary();
    if (selectMode()) {
      // Checked rows may sit beyond the loaded page; only drop the ones
      // that left the view (deleted, converted, filtered out).
      const live = new Set(visible().map((i) => i.id));
      const sel = selected();
      if ([...sel].some((id) => !live.has(id))) setSelected(new Set([...sel].filter((id) => live.has(id))));
      if (!p || !ids.includes(p)) setPrimary(ids[0] ?? null);
      return;
    }
    if (p && ids.includes(p)) {
      // Drop selected rows that are no longer visible.
      const sel = selected();
      if ([...sel].some((id) => !ids.includes(id))) {
        setSelected(new Set([...sel].filter((id) => ids.includes(id))));
      }
      return;
    }
    selectOnly(ids[0] ?? null);
  });

  function onRowClick(e: MouseEvent, id: string) {
    listRef?.focus({ preventScroll: true });
    const from = anchor() ?? primary();
    const range = e.shiftKey && from ? rangeBetween(visibleIds(), from, id) : null;
    if (range) {
      // Shift-click: adds the range (starts the selection mode from the
      // plain list).
      if (selectMode()) setSelected((prev) => withIds(prev, range, true));
      else enterSelectMode(range);
      setPrimary(id);
      setAnchor(id);
      return;
    }
    if (selectMode() || isModKey(e)) {
      // ⌘-click on the plain list starts the selection with the current row.
      if (!selectMode()) enterSelectMode(primary() && primary() !== id ? [primary()!] : []);
      setSelected((prev) => toggleIds(prev, [id]));
      setPrimary(id);
      setAnchor(id);
      return;
    }
    selectOnly(id);
  }

  function toggleRow(id: string) {
    setSelected((prev) => toggleIds(prev, [id]));
    setAnchor(id);
  }

  function move(delta: number) {
    const ids = visibleIds();
    if (ids.length === 0) return;
    const cur = primary() ? ids.indexOf(primary()!) : -1;
    const next = cur < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, cur + delta));
    if (!selectMode()) {
      selectOnly(ids[next], true);
      return;
    }
    // Selection mode: the arrows move the detail row, space checks it.
    const id = ids[next];
    setPrimary(id);
    setAnchor(id);
    queueMicrotask(() => document.getElementById(`idea-row-${id}`)?.scrollIntoView({ block: "nearest" }));
  }

  const studioConnected = () => tryParseConnectCode(settingsStore.studioConnectCode()) !== null;
  const errorToast = (err: unknown) =>
    pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error");

  // ---- actions ----
  async function capture(text: string, startScript: boolean) {
    const title = text.trim();
    if (!title) return;
    const fid = activeFolder();
    try {
      const idea = await ideasStore.createIdea({
        title,
        folderId: fid === INBOX_FOLDER_ID ? null : fid,
      });
      if (captureRef) captureRef.value = "";
      if (startScript) {
        await convert(idea);
        return;
      }
      setQuery("");
      setWanted(idea.id);
    } catch (err) {
      errorToast(err);
    }
  }

  async function convert(idea: Idea) {
    if (idea.used_at) return;
    await detail?.flush();
    try {
      const { script } = await ideasStore.convertIdeaToScript({
        ideaId: idea.id,
        folderId: idea.folder_id,
      });
      pushToast(t("script.toast.created", { title: script.title }), "ok");
      navStore.openScript(script.id, script.title);
    } catch (err) {
      errorToast(err);
    }
  }

  async function removeIdeas(list: Idea[]) {
    if (list.length === 0) return;
    const ok = await confirmDialog(
      list.length === 1
        ? {
            title: t("ideas.confirm.delete.title"),
            body: t("ideas.confirm.delete.body", { title: list[0].title }),
            confirmLabel: t("common.delete"),
            danger: true,
          }
        : {
            title: t("ideasPage.confirm.deleteMany.title"),
            body: tPlural("ideasPage.confirm.deleteMany.body", list.length),
            confirmLabel: t("common.delete"),
            danger: true,
          },
    );
    if (!ok) return;
    try {
      for (const idea of list) await ideasStore.deleteIdea(idea.id);
      pushToast(
        list.length === 1
          ? t("ideas.toast.deleted", { title: list[0].title })
          : tPlural("ideasPage.toast.deletedMany", list.length),
        "ok",
      );
    } catch (err) {
      errorToast(err);
    }
  }

  async function moveIdeas(list: Idea[], folderId: string | null, name = folderName(folderId)) {
    const todo = list.filter((i) => i.folder_id !== folderId);
    if (todo.length === 0) return;
    try {
      for (const idea of todo) await ideasStore.moveIdea(idea.id, folderId);
      pushToast(t("folder.toast.movedTo", { name }), "ok");
    } catch (err) {
      errorToast(err);
    }
  }

  /** Bulk "Zu Skripten": every open idea of `list` becomes a script in
   *  `stage` (same folder as the idea). Converted ideas are skipped. */
  async function convertIdeas(list: Idea[], stage: ScriptStatus) {
    const open = list.filter((i) => !i.used_at);
    const skipped = list.length - open.length;
    if (open.length === 0) return;
    await detail?.flush();
    let done = 0;
    try {
      for (const idea of open) {
        const { script } = await ideasStore.convertIdeaToScript({ ideaId: idea.id });
        if (stage !== "writing") await api.setScriptStatus(script.id, stage);
        done++;
      }
    } catch (err) {
      errorToast(err);
    } finally {
      if (done > 0 && stage !== "writing") scriptsBus.bump();
    }
    if (done > 0) {
      pushToast(tPlural("ideasPage.toast.convertedMany", done, { stage: t(`stage.${stage}`) }), "ok");
    }
    if (skipped > 0) pushToast(tPlural("ideasPage.toast.convertSkipped", skipped), "info");
  }

  const selectedIdeas = () => {
    const sel = selected();
    return visible().filter((i) => sel.has(i.id));
  };

  // ---- selection bar menus ----
  const [menu, setMenu] = createSignal<{ x: number; y: number; width?: number; items: ContextMenuItem[] } | null>(
    null,
  );
  const [newFolderFor, setNewFolderFor] = createSignal<Idea[] | null>(null);
  const menuAbove = (el: HTMLElement, items: ContextMenuItem[], width?: number) => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.top - 6, width, items });
  };

  function moveMenu(list: Idea[]): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      { label: t("folder.none"), onClick: () => void moveIdeas(list, null) },
    ];
    for (const f of folders() ?? []) {
      items.push({
        label: f.name,
        icon: <span class="fdot" style={{ background: folderColor(f.id) }} />,
        onClick: () => void moveIdeas(list, f.id, f.name),
      });
    }
    items.push({
      label: t("folder.newDots"),
      icon: "plus",
      separatorBefore: true,
      onClick: () => setNewFolderFor(list),
    });
    return items;
  }

  const stageMenu = (list: Idea[]): ContextMenuItem[] =>
    SCRIPT_STATUSES.map((st) => ({
      label: t(`stage.${st}`),
      icon: <StageGlyph stage={st} />,
      onClick: () => void convertIdeas(list, st),
    }));

  /** Selects `id` and scrolls it into view, first clearing whatever hides
   *  it: the text filter, "show used", the folder chip. Collapsed groups and
   *  the month cap are opened by the selection effect above. */
  function revealIdea(id: string) {
    const idea = ideas().find((i) => i.id === id);
    if (idea) {
      if (scopeIdeas([idea], { query: query(), showUsed: true }).length === 0) setQuery("");
      if (idea.used_at && !showUsed()) setShowUsed(true);
      if (inFolder([idea], activeFolder()).length === 0) {
        // The folder filter lives in the route, which applies after the
        // save flush - select once it did.
        void navStore.openIdeas(null).then(() => setWanted(id));
        return;
      }
    }
    setWanted(id);
  }

  // Reveal requests from outside the page (command palette).
  createEffect(() => {
    if (uiStore.ideaToReveal() === null) return;
    const id = uiStore.takeIdeaReveal();
    if (id) untrack(() => revealIdea(id));
  });

  // ---- keyboard ----
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || uiStore.anyDialogOpen() || menu()) return;
    const target = e.target as HTMLElement | null;
    // Legacy modals (confirm) and open menus handle their own keys.
    if (target?.closest?.(".modal-backdrop, .scrim, .menu") || document.querySelector(".modal-backdrop")) return;
    const editable = isEditable(target);
    const inDetail = !!target?.closest?.(".idet");

    if (e.key === "Enter" && isModKey(e)) {
      if (editable && !inDetail) return; // capture / filter fields handle it
      const idea = primaryIdea();
      if (idea) {
        e.preventDefault();
        void convert(idea);
      }
      return;
    }
    if (editable) return;
    if (isModKey(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
      if (target instanceof HTMLButtonElement && target.closest(".idet")) return;
      if (selectableIds().length > 0) {
        e.preventDefault();
        selectAll();
      }
      return;
    }
    if (e.key === " " && selectMode() && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      const id = primary();
      if (id) {
        e.preventDefault();
        toggleRow(id);
      }
      return;
    }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      filterRef?.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (target instanceof HTMLButtonElement && target.closest(".idet, .i-chips, .ideas-bar")) return;
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      if (primaryIdea() && !primaryIdea()!.used_at) {
        e.preventDefault();
        detail?.focusNotes();
      }
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey) {
      if (target instanceof HTMLButtonElement && !target.closest(".ilist")) return;
      const list = selectMode() ? selectedIdeas() : primaryIdea() ? [primaryIdea()!] : [];
      if (list.length > 0) {
        e.preventDefault();
        void removeIdeas(list);
      }
      return;
    }
    if (e.key === "Escape" && selectMode()) {
      e.preventDefault();
      exitSelectMode();
    }
  };
  onMount(() => {
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  const sortOptions = () => [
    { id: "newest" as IdeaSort, label: t("ideasPage.sort.newest") },
    { id: "oldest" as IdeaSort, label: t("ideasPage.sort.oldest") },
    { id: "title" as IdeaSort, label: t("ideasPage.sort.title") },
  ];

  const keyHint = (k: string, text: string) => (
    <>
      <kbd>{k}</kbd> {text}
    </>
  );

  return (
    <div class="ideas-page">
      <PageBar title={t("ideasPage.title")}>
        <SortMenu options={sortOptions()} value={sort()} onChange={setSort} ariaLabel={t("ideasPage.sort.aria")} />
        <button
          type="button"
          class="btn ghost ideas-used-tg"
          classList={{ "is-on": showUsed() }}
          aria-pressed={showUsed()}
          onClick={() => setShowUsed(!showUsed())}
        >
          <Show when={showUsed()}>
            <Icon name="check" size={13} />
          </Show>
          {t("ideasPage.bar.showUsed")}
        </button>
        <button
          type="button"
          class="btn ghost"
          classList={{ "is-on": selectMode() }}
          aria-pressed={selectMode()}
          disabled={!selectMode() && visible().length === 0}
          onClick={() => (selectMode() ? exitSelectMode() : enterSelectMode())}
        >
          <Icon name="select" />
          {t("select.enter")}
        </button>
      </PageBar>

      <div class="ideas">
        <div class="ideas-main">
          <div class="i-head">
            <h1>{t("ideasPage.title")}</h1>
            <span>{t("ideasPage.head.counts", { open: openCount(), fresh: freshCount() })}</span>
          </div>

          <label class="i-cap">
            <span class="i-cap-plus" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <input
              ref={captureRef}
              class="i-cap-input"
              placeholder={t("ideasPage.capture.placeholder")}
              aria-label={t("ideasPage.capture.aria")}
              spellcheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void capture(e.currentTarget.value, isModKey(e));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.currentTarget.value = "";
                  e.currentTarget.blur();
                }
              }}
            />
            <kbd>⏎</kbd>
            <span class="i-cap-hint">{t("ideasPage.capture.hint", { key: K("Mod+I") })}</span>
          </label>

          <div class="i-chips" role="group" aria-label={t("ideasPage.chips.aria")}>
            <button
              type="button"
              class="fchip"
              aria-pressed={activeFolder() === null}
              onClick={() => setFolder(null)}
            >
              {t("ideasPage.chips.all")} <em>{scoped().length}</em>
            </button>
            <For each={chipFolders()}>
              {(f) => (
                <button
                  type="button"
                  class="fchip"
                  aria-pressed={activeFolder() === f.id}
                  onClick={() => setFolder(f.id)}
                >
                  <i style={{ background: folderColor(f.id) }} />
                  {f.name} <em>{counts().byFolder.get(f.id) ?? 0}</em>
                </button>
              )}
            </For>
            <Show when={(folders() ?? []).length > 0 && (counts().inbox > 0 || activeFolder() === INBOX_FOLDER_ID)}>
              <button
                type="button"
                class="fchip"
                aria-pressed={activeFolder() === INBOX_FOLDER_ID}
                onClick={() => setFolder(INBOX_FOLDER_ID)}
              >
                {t("ideasPage.chips.none")} <em>{counts().inbox}</em>
              </button>
            </Show>
            <span class="sp" />
            <label class="field-box i-filter">
              <Icon name="search" size={13} />
              <input
                ref={filterRef}
                value={query()}
                placeholder={t("ideasPage.filter.placeholder")}
                aria-label={t("ideasPage.filter.placeholder")}
                spellcheck={false}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (query()) setQuery("");
                    else e.currentTarget.blur();
                  } else if (e.key === "ArrowDown" || e.key === "Enter") {
                    e.preventDefault();
                    e.currentTarget.blur();
                    listRef?.focus();
                    if (e.key === "ArrowDown") move(0);
                  }
                }}
              />
              <Show when={query()} fallback={<kbd>/</kbd>}>
                <button
                  type="button"
                  class="i-filter-clear"
                  aria-label={t("ideasPage.filter.clear")}
                  title={t("ideasPage.filter.clear")}
                  onClick={() => setQuery("")}
                >
                  <Icon name="x" size={12} />
                </button>
              </Show>
            </label>
          </div>

          <Show when={selectMode() && selectableIds().length > 0}>
            <SelectAllLine state={allState()} count={selectableIds().length} onToggle={toggleAll} />
          </Show>

          <div class="ilist-scroll" classList={{ "has-selbar": selectMode() }}>
            <Show
              when={groups().length > 0}
              fallback={
                <div class="i-empty">
                  <b>
                    {ideas().length === 0
                      ? t("ideasPage.empty.none")
                      : filtering()
                        ? t("ideasPage.empty.query", { query: query().trim() })
                        : activeFolder() !== null
                          ? t("ideasPage.empty.folder")
                          : t("ideasPage.empty.allUsed")}
                  </b>
                  <span>
                    {ideas().length === 0
                      ? t("ideasPage.empty.noneSub")
                      : filtering()
                        ? t("ideasPage.empty.querySub")
                        : activeFolder() !== null
                          ? t("ideasPage.empty.folderSub")
                          : t("ideasPage.empty.allUsedSub")}
                  </span>
                </div>
              }
            >
              <div
                ref={listRef}
                class="ilist"
                classList={{ "is-selecting": selectMode() }}
                role="listbox"
                aria-multiselectable="true"
                aria-label={t("ideasPage.list.aria")}
                aria-activedescendant={primary() ? `idea-row-${primary()}` : undefined}
                tabindex="0"
              >
                <For each={paging().rendered}>
                  {(g) => (
                    <>
                      <div class="igrp-h" classList={{ closed: !isOpen(g) }}>
                        <Show when={selectMode()}>
                          <SelectCheck
                            state={checkState(g.items.map((i) => i.id), selected())}
                            label={t("select.group", { name: groupLabel(g, new Date(now())) })}
                            onToggle={() => setSelected((prev) => toggleIds(prev, g.items.map((i) => i.id)))}
                          />
                        </Show>
                        <button
                          type="button"
                          class="igrp-tog"
                          aria-expanded={isOpen(g)}
                          onClick={() => setGroupOpen({ ...groupOpen(), [g.id]: !isOpen(g) })}
                        >
                          <Icon name={isOpen(g) ? "down" : "right"} size={11} />
                          {groupLabel(g, new Date(now()))} <em>{g.items.length}</em>
                        </button>
                      </div>
                      <Show when={isOpen(g)}>
                        <For each={shownItems(g)}>
                          {(idea) => (
                            <div
                              id={`idea-row-${idea.id}`}
                              class="irow"
                              classList={{
                                "is-sel": selected().has(idea.id),
                                "is-primary": primary() === idea.id,
                                "is-used": !!idea.used_at,
                              }}
                              role="option"
                              aria-selected={selected().has(idea.id)}
                              onMouseDown={(e) => {
                                if (e.shiftKey) e.preventDefault();
                              }}
                              onClick={(e) => onRowClick(e, idea.id)}
                              onDblClick={() => {
                                if (selectMode()) return;
                                selectOnly(idea.id);
                                queueMicrotask(() => detail?.focusNotes());
                              }}
                            >
                              <Switch>
                                <Match when={selectMode()}>
                                  <span
                                    class="selchk-box"
                                    classList={{ "is-on": selected().has(idea.id) }}
                                    aria-hidden="true"
                                  >
                                    <Show when={selected().has(idea.id)}>
                                      <Icon name="check" size={11} />
                                    </Show>
                                  </span>
                                </Match>
                                <Match when={idea.used_at}>
                                  <Icon name="check" size={14} />
                                </Match>
                                <Match when={true}>
                                  <StageGlyph stage="idea" />
                                </Match>
                              </Switch>
                              <div class="ti">{idea.title}</div>
                              <div class="nt">
                                <Show when={idea.used_at} fallback={idea.notes.split("\n")[0]}>
                                  <Show
                                    when={idea.script_id ? scripts().get(idea.script_id) : undefined}
                                    fallback={<span class="stale">{t("ideas.card.linked.stale")}</span>}
                                  >
                                    {(s) => (
                                      <button
                                        type="button"
                                        class="ilink"
                                        title={t("ideas.card.linked.title")}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navStore.openScript(s().id, s().title);
                                        }}
                                      >
                                        <Icon name="doc" size={12} />
                                        {s().title || t("common.untitled")}
                                      </button>
                                    )}
                                  </Show>
                                </Show>
                              </div>
                              <div class="fo">
                                <Show when={idea.folder_id}>
                                  {(fid) => (
                                    <>
                                      <i style={{ background: folderColor(fid()) }} />
                                      <span>{folderName(fid())}</span>
                                    </>
                                  )}
                                </Show>
                              </div>
                              <div class="ag">{ideaAge(idea.created_at, now())}</div>
                            </div>
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
                <Show when={paging().remaining > 0}>
                  <button type="button" class="irow more" onClick={() => setRowLimit(rowLimit() + PAGE_SIZE)}>
                    <span />
                    <span>{t("ideasPage.loadMore", { count: Math.min(PAGE_SIZE, paging().remaining) })}</span>
                  </button>
                </Show>
              </div>
            </Show>
          </div>

          <div class="i-keys" classList={{ "is-hidden": selectMode() }}>
            {keyHint("↑ ↓", t("ideasPage.keys.select"))} ·{" "}
            {keyHint("⏎", t("ideasPage.keys.edit"))} ·{" "}
            {keyHint(K("Mod+Enter"), t("ideasPage.keys.convert"))} ·{" "}
            {keyHint("⌫", t("ideasPage.keys.delete"))} ·{" "}
            <kbd>{K("Shift")}</kbd>
            {t("ideasPage.keys.multi")}
          </div>

          <Show when={selectMode()}>
            <SelectionBar
              count={selected().size}
              allSelected={allState() === "all"}
              onSelectAll={selectAll}
              onClear={() => setSelected(new Set<string>())}
              onExit={exitSelectMode}
              onSend={studioConnected() ? () => setHandoffOpen(true) : undefined}
              onMove={(el) => menuAbove(el, moveMenu(selectedIdeas()))}
              onStage={(el) => menuAbove(el, stageMenu(selectedIdeas()), 200)}
              stageLabel={t("ideasPage.selection.convert")}
              stageDisabled={selectedIdeas().every((i) => !!i.used_at)}
              onTrash={() => void removeIdeas(selectedIdeas())}
              trashLabel={t("common.delete")}
            />
          </Show>
        </div>

        <aside class="idet" aria-label={t("ideasPage.detail.aria")}>
          <Show
            when={primary() && primaryIdea()}
            fallback={<p class="idet-empty">{t("ideasPage.detail.empty")}</p>}
          >
            {/* Keyed by id: a different idea remounts the panel (fresh drafts). */}
            <For each={[primary()!]}>
              {(id) => (
                <IdeaDetail
                  ideaId={id}
                  ideas={ideas()}
                  folders={folders() ?? []}
                  scripts={scripts()}
                  now={now()}
                  onReady={(h) => (detail = h)}
                  onConvert={(idea) => void convert(idea)}
                  onDelete={(idea) => void removeIdeas([idea])}
                  onMove={(idea, fid) => void moveIdeas([idea], fid)}
                  onOpenScript={(sid, title) => navStore.openScript(sid, title)}
                  onSelectIdea={revealIdea}
                  onLeave={() => listRef?.focus()}
                />
              )}
            </For>
          </Show>
        </aside>
      </div>

      <HandoffDialog
        open={handoffOpen()}
        scriptIds={[]}
        ideaIds={[...selected()]}
        onClose={() => setHandoffOpen(false)}
        onSent={() => {
          setHandoffOpen(false);
          exitSelectMode();
          ideasStore.refresh();
        }}
      />

      <Show when={menu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            align="start"
            placement="above"
            width={m().width}
            items={m().items}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>

      <PromptDialog
        open={newFolderFor() !== null}
        title={t("folder.createTitle")}
        label={t("common.name")}
        initialValue=""
        placeholder={t("folder.placeholder")}
        submitLabel={t("folder.createSubmit")}
        onClose={() => setNewFolderFor(null)}
        onSubmit={async (v) => {
          const list = newFolderFor() ?? [];
          const created = await createFolder(v);
          if (!created) return;
          setNewFolderFor(null);
          await moveIdeas(list, created.id, created.name);
        }}
      />
    </div>
  );
}

export default IdeasPage;
