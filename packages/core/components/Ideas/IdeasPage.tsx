import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  on,
  onMount,
  untrack,
  type Accessor,
} from "solid-js";
import { api } from "../../lib/api";
import { foldersBus } from "../../lib/foldersBus";
import { scriptsBus } from "../../lib/scriptsBus";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { flushAll } from "../../lib/saveFlush";
import { tryParseConnectCode } from "../../lib/handoff";
import { K, isModKey } from "../../lib/keys";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { settingsStore } from "../../stores/settings";
import { pushToast } from "../../stores/toasts";
import { localeCompare, t, tPlural } from "../../i18n";
import type { Folder, Idea, ScriptSummary } from "../../lib/types";
import { Icon } from "../Common/Icon";
import { StageGlyph } from "../Common/StageGlyph";
import { confirmDialog } from "../Common/ConfirmDialog";
import { HandoffDialog } from "../Library/HandoffDialog";
import { PageBar } from "../Library/PageBar";
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
import { similarIdeas } from "./similar";
import { FolderMenu } from "./parts/FolderMenu";
import { SortMenu } from "./parts/SortMenu";
import { IdeaEditor, type IdeaEditorHandle } from "./parts/IdeaEditor";
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

/** The ideas page (route `{ kind: "ideas", folderId? }`): capture field
 *  (expands for notes + folder), folder chips and a dense time-grouped
 *  list whose rows open in place into an editor (IdeaEditor). */
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

  /** The row shown expanded as an editor (always the primary selection). */
  const [openId, setOpenId] = createSignal<string | null>(null);
  /** The text filter when the row was opened: while it is unchanged, the
   *  open idea stays listed even if editing it stops it from matching. */
  const [openQuery, setOpenQuery] = createSignal("");

  // ---- derived lists ----
  const scoped = createMemo(() => {
    const list = scopeIdeas(ideas(), { query: query(), showUsed: showUsed() });
    const id = openId();
    if (!id || query() !== openQuery() || list.some((i) => i.id === id)) return list;
    const pinned = scopeIdeas(
      ideas().filter((i) => i.id === id),
      { query: "", showUsed: showUsed() },
    );
    return pinned.length > 0 ? [...list, ...pinned] : list;
  });
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

  const groupById = createMemo(() => new Map(groups().map((g) => [g.id, g])));
  const ideaById = createMemo(() => new Map(ideas().map((i) => [i.id, i])));

  // ---- selection ----
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const [primary, setPrimary] = createSignal<string | null>(null);
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [wanted, setWanted] = createSignal<string | null>(null);
  /** Open the wanted idea's row once it is selected. */
  const [wantedOpen, setWantedOpen] = createSignal(false);
  const [handoffOpen, setHandoffOpen] = createSignal(false);
  let editor: IdeaEditorHandle | null = null;
  let listRef: HTMLDivElement | undefined;
  let captureRef: HTMLInputElement | undefined;
  let captureNotesRef: HTMLTextAreaElement | undefined;
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

  // Keep a valid selection: follow a wanted idea (freshly created, or
  // revealed via palette / similar link) once it shows up, otherwise fall
  // back to the first visible row.
  createEffect(() => {
    const ids = visibleIds();
    const want = wanted();
    if (want) {
      if (ids.includes(want)) {
        const openIt = wantedOpen();
        batch(() => {
          setWanted(null);
          setWantedOpen(false);
          selectOnly(want, true);
          if (openIt) {
            setOpenQuery(query());
            setOpenId(want);
          }
        });
        if (openIt) focusEditor();
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
      if (ideas().some((i) => i.id === want)) {
        // Hidden by a filter.
        setWanted(null);
        setWantedOpen(false);
      } else return; // not loaded yet
    }
    const p = primary();
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

  // Only the primary row of a single selection stays open: moving the
  // selection, multi-selecting, filtering it away or deleting it closes it.
  createEffect(() => {
    const id = openId();
    if (!id) return;
    if (primary() !== id || selected().size > 1 || !visibleIds().includes(id)) setOpenId(null);
  });

  /** Focuses the open editor's notes (read-only for used ideas: the list
   *  keeps focus). */
  function focusEditor() {
    const idea = openId() ? ideas().find((i) => i.id === openId()) : undefined;
    queueMicrotask(() => {
      if (idea && !idea.used_at) editor?.focusNotes();
      else listRef?.focus({ preventScroll: true });
    });
  }

  function openRow(id: string) {
    batch(() => {
      selectOnly(id, true);
      setOpenQuery(query());
      setOpenId(id);
    });
    focusEditor();
  }

  function closeRow() {
    void editor?.flush();
    setOpenId(null);
    listRef?.focus({ preventScroll: true });
  }

  function onRowClick(e: MouseEvent, id: string) {
    listRef?.focus({ preventScroll: true });
    if (e.shiftKey && anchor()) {
      const ids = visibleIds();
      const a = ids.indexOf(anchor()!);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(new Set(ids.slice(from, to + 1)));
        setPrimary(id);
        return;
      }
    }
    if (isModKey(e)) {
      const next = new Set(selected());
      if (next.has(id) && next.size > 1) {
        next.delete(id);
        setSelected(next);
        if (primary() === id) setPrimary([...next][next.size - 1] ?? null);
      } else {
        next.add(id);
        setSelected(next);
        setPrimary(id);
      }
      setAnchor(id);
      return;
    }
    openRow(id);
  }

  function move(delta: number) {
    const ids = visibleIds();
    if (ids.length === 0) return;
    const cur = primary() ? ids.indexOf(primary()!) : -1;
    const next = cur < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, cur + delta));
    selectOnly(ids[next], true);
  }

  const studioConnected = () => tryParseConnectCode(settingsStore.studioConnectCode()) !== null;
  const errorToast = (err: unknown) =>
    pushToast(t("common.errorPrefix", { message: (err as Error)?.message ?? String(err) }), "error");

  // ---- capture field ----
  const [capTitle, setCapTitle] = createSignal("");
  const [capNotes, setCapNotes] = createSignal("");
  const [capOpen, setCapOpen] = createSignal(false);
  /** Explicitly picked folder; undefined follows the folder filter. */
  const [capFolder, setCapFolder] = createSignal<string | null | undefined>(undefined);
  const capFolderValue = () => {
    const picked = capFolder();
    if (picked !== undefined) return picked;
    const fid = activeFolder();
    return fid === INBOX_FOLDER_ID ? null : fid;
  };
  /** Existing ideas resembling the title being typed (duplicate check). */
  const capSimilar = createMemo(() =>
    capOpen() ? similarIdeas({ id: "", title: capTitle() }, ideas(), 2) : [],
  );

  function growCaptureNotes() {
    const el = captureNotesRef;
    if (!el) return;
    el.style.height = "auto";
    // scrollHeight excludes the border; add it back so no scrollbar shows.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }

  function expandCapture() {
    setCapOpen(true);
    queueMicrotask(() => {
      growCaptureNotes();
      captureNotesRef?.focus({ preventScroll: true });
    });
  }

  /** Closes the expanded part; its notes and folder pick are dropped so
   *  nothing invisible rides along with the next idea. */
  function collapseCapture() {
    batch(() => {
      setCapOpen(false);
      setCapNotes("");
      setCapFolder(undefined);
    });
    captureRef?.focus({ preventScroll: true });
  }

  // ---- actions ----
  async function capture(startScript: boolean) {
    const title = capTitle().trim();
    if (!title) return;
    const draft = { title: capTitle(), notes: capNotes(), folder: capFolder(), open: capOpen() };
    const folderId = capFolderValue();
    // Clear right away: the field stays usable for the next idea while this
    // one is saved (and a second Enter cannot submit it twice).
    batch(() => {
      setCapTitle("");
      setCapNotes("");
      setCapFolder(undefined);
      setCapOpen(false);
    });
    // Focus stays in the field for the next idea.
    captureRef?.focus({ preventScroll: true });
    try {
      const idea = await ideasStore.createIdea({ title, notes: draft.notes.trim(), folderId });
      if (startScript) {
        await convert(idea);
        return;
      }
      setQuery("");
      setWantedOpen(false);
      setWanted(idea.id);
    } catch (err) {
      // Give the text back unless the field was reused meanwhile.
      if (!capTitle() && !capNotes()) {
        batch(() => {
          setCapTitle(draft.title);
          setCapNotes(draft.notes);
          setCapFolder(draft.folder);
          setCapOpen(draft.open);
        });
      }
      errorToast(err);
    }
  }

  async function convert(idea: Idea) {
    if (idea.used_at) return;
    // All pending idea drafts, including a row collapsed a moment ago.
    await flushAll();
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

  async function moveIdeas(list: Idea[], folderId: string | null) {
    const todo = list.filter((i) => i.folder_id !== folderId);
    if (todo.length === 0) return;
    try {
      for (const idea of todo) await ideasStore.moveIdea(idea.id, folderId);
      pushToast(t("folder.toast.movedTo", { name: folderName(folderId) }), "ok");
    } catch (err) {
      errorToast(err);
    }
  }

  const selectedIdeas = () => {
    const sel = selected();
    return visible().filter((i) => sel.has(i.id));
  };

  /** Selects `id` (and opens its row) and scrolls it into view, first
   *  clearing whatever hides it: the text filter, "show used", the folder
   *  chip. Collapsed groups and the page limit are handled by the selection
   *  effect above. */
  function revealIdea(id: string) {
    setWantedOpen(true);
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
    if (e.defaultPrevented || uiStore.anyDialogOpen()) return;
    const target = e.target as HTMLElement | null;
    // Legacy modals (confirm) and open menus handle their own keys.
    if (target?.closest?.(".modal-backdrop, .scrim, .menu") || document.querySelector(".modal-backdrop")) return;
    const editable = isEditable(target);
    const inEditor = !!target?.closest?.(".ix");

    if (e.key === "Enter" && isModKey(e)) {
      if (editable && !inEditor) return; // capture / filter fields handle it
      if (target?.closest?.(".i-cap")) {
        // A capture button (folder, similar link, ...) has focus.
        e.preventDefault();
        void capture(true);
        return;
      }
      const idea = primaryIdea();
      if (idea) {
        e.preventDefault();
        void convert(idea);
      }
      return;
    }
    if (editable) return;
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      filterRef?.focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (target instanceof HTMLButtonElement && target.closest(".ix, .i-cap, .i-chips")) return;
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      const idea = primaryIdea();
      if (idea && selected().size === 1) {
        e.preventDefault();
        if (openId() === idea.id) focusEditor();
        else openRow(idea.id);
      }
      return;
    }
    if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey) {
      if (target instanceof HTMLButtonElement && (!target.closest(".ilist") || target.closest(".ix"))) return;
      const list = selected().size > 1 ? selectedIdeas() : primaryIdea() ? [primaryIdea()!] : [];
      if (list.length > 0) {
        e.preventDefault();
        void removeIdeas(list);
      }
      return;
    }
    if (e.key === "Escape") {
      if (openId()) {
        e.preventDefault();
        closeRow();
      } else if (selected().size > 1) {
        e.preventDefault();
        selectOnly(primary());
      }
    }
  };
  onMount(() => {
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  /** A collapsed list row; a click opens it in place. */
  const ideaRow = (idea: Accessor<Idea>) => (
    <div
      id={`idea-row-${idea().id}`}
      class="irow"
      classList={{
        "is-sel": selected().has(idea().id),
        "is-primary": primary() === idea().id,
        "is-used": !!idea().used_at,
      }}
      role="option"
      aria-selected={selected().has(idea().id)}
      onMouseDown={(e) => {
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => onRowClick(e, idea().id)}
    >
      <Show when={idea().used_at} fallback={<StageGlyph stage="idea" />}>
        <Icon name="check" size={14} />
      </Show>
      <div class="ti">{idea().title}</div>
      <div class="nt">
        <Show when={idea().used_at} fallback={idea().notes.split("\n")[0]}>
          <Show
            when={idea().script_id ? scripts().get(idea().script_id!) : undefined}
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
        <Show when={idea().folder_id}>
          {(fid) => (
            <>
              <i style={{ background: folderColor(fid()) }} />
              <span>{folderName(fid())}</span>
            </>
          )}
        </Show>
      </div>
      <div class="ag">{ideaAge(idea().created_at, now())}</div>
      <span class="irow-chev" aria-hidden="true">
        <Icon name="down" size={13} />
      </span>
    </div>
  );

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
      </PageBar>

      <div class="ideas">
        <div class="ideas-main">
          <div class="i-head">
            <h1>{t("ideasPage.title")}</h1>
            <span>{t("ideasPage.head.counts", { open: openCount(), fresh: freshCount() })}</span>
          </div>

          <div class="i-cap" classList={{ "is-open": capOpen() }}>
            <div
              class="i-cap-row"
              onMouseDown={(e) => {
                // The whole row focuses the input, like a label would.
                if (!(e.target as HTMLElement).closest("button, input")) {
                  e.preventDefault();
                  captureRef?.focus();
                }
              }}
            >
              <span class="i-cap-plus" aria-hidden="true">
                <Icon name="plus" />
              </span>
              <input
                ref={captureRef}
                class="i-cap-input"
                value={capTitle()}
                placeholder={t("ideasPage.capture.placeholder")}
                aria-label={t("ideasPage.capture.aria")}
                spellcheck={false}
                onInput={(e) => setCapTitle(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void capture(isModKey(e));
                  } else if (
                    !capOpen() &&
                    ((e.key === "Tab" && !e.shiftKey && !e.altKey && !isModKey(e)) || (e.key === "Enter" && e.shiftKey))
                  ) {
                    e.preventDefault();
                    expandCapture();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    if (capOpen()) {
                      collapseCapture();
                    } else {
                      setCapTitle("");
                      e.currentTarget.blur();
                    }
                  }
                }}
              />
              <Show when={!capOpen()}>
                <kbd>⏎</kbd>
                <button
                  type="button"
                  class="btn ghost sm"
                  tabindex="-1"
                  title={t("ideasPage.capture.addNoteTitle")}
                  onClick={expandCapture}
                >
                  <Icon name="pen" size={13} />
                  {t("ideasPage.capture.addNote")}
                  <kbd>⇥</kbd>
                </button>
              </Show>
              <span class="i-cap-hint">{t("ideasPage.capture.hint", { key: K("Mod+I") })}</span>
            </div>
            <Show when={capOpen()}>
              <textarea
                ref={captureNotesRef}
                class="i-cap-notes"
                rows={2}
                value={capNotes()}
                placeholder={t("ideasPage.detail.notesPlaceholder")}
                aria-label={t("ideasPage.capture.notesAria")}
                onInput={(e) => {
                  setCapNotes(e.currentTarget.value);
                  growCaptureNotes();
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && isModKey(e)) {
                    e.preventDefault();
                    void capture(true);
                  } else if (e.key === "Escape") {
                    // Back to the title; a second esc closes the notes.
                    e.preventDefault();
                    captureRef?.focus({ preventScroll: true });
                  }
                }}
              />
              <div class="i-cap-foot">
                <FolderMenu
                  folders={folders() ?? []}
                  value={capFolderValue()}
                  onChange={setCapFolder}
                  ariaLabel={t("ideasPage.capture.folderAria")}
                />
                <Show when={capSimilar().length > 0}>
                  <div class="i-sim">
                    <span>{t("ideasPage.detail.similar")}</span>
                    <For each={capSimilar()}>
                      {(other) => (
                        <button
                          type="button"
                          class="i-sim-it"
                          title={`${other.title} · ${t("stage.idea")}`}
                          onClick={() => revealIdea(other.id)}
                        >
                          <Show when={other.used} fallback={<StageGlyph stage="idea" />}>
                            <Icon name="check" size={14} />
                          </Show>
                          <span>{other.title}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <div class="i-cap-act">
                  <button
                    type="button"
                    class="btn"
                    disabled={!capTitle().trim()}
                    onClick={() => void capture(true)}
                  >
                    {t("ideasPage.detail.convert")}
                    <kbd>{K("Mod+Enter")}</kbd>
                  </button>
                  <button
                    type="button"
                    class="btn primary"
                    disabled={!capTitle().trim()}
                    onClick={() => void capture(false)}
                  >
                    {t("capture.remember")}
                    <kbd>⏎</kbd>
                  </button>
                </div>
              </div>
            </Show>
          </div>

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

          <Show when={selected().size > 1}>
            <div class="isel" role="toolbar" aria-label={t("ideasPage.selection.aria")}>
              <b>{t("ideasPage.selection.count", { count: selected().size })}</b>
              <FolderMenu
                variant="ghost"
                label={t("ideasPage.selection.move")}
                folders={folders() ?? []}
                value={null}
                onChange={(fid) => void moveIdeas(selectedIdeas(), fid)}
              />
              <Show when={studioConnected()}>
                <button type="button" class="btn ghost" onClick={() => setHandoffOpen(true)}>
                  <Icon name="cloud" />
                  {t("ideasPage.selection.send")}
                </button>
              </Show>
              <button type="button" class="btn ghost" onClick={() => void removeIdeas(selectedIdeas())}>
                <Icon name="trash" />
                {t("common.delete")}
              </button>
              <span class="sp" />
              <button type="button" class="btn ghost" onClick={() => selectOnly(primary())}>
                {t("ideasPage.selection.clear")}
                <kbd>esc</kbd>
              </button>
            </div>
          </Show>

          <div class="ilist-scroll">
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
                role="listbox"
                aria-multiselectable="true"
                aria-label={t("ideasPage.list.aria")}
                aria-activedescendant={primary() && primary() !== openId() ? `idea-row-${primary()}` : undefined}
                tabindex="0"
              >
                {/* Keyed by id, not by object: every store refresh (e.g. after an
                    autosave) brings new objects, and remounting would tear down
                    the open editor mid-typing. */}
                <For each={paging().rendered.map((g) => g.id)}>
                  {(gid) => (
                    <Show when={groupById().get(gid)}>
                      {(g) => (
                        <>
                          <button
                            type="button"
                            class="igrp-h"
                            classList={{ closed: !isOpen(g()) }}
                            aria-expanded={isOpen(g())}
                            onClick={() => setGroupOpen({ ...groupOpen(), [gid]: !isOpen(g()) })}
                          >
                            <Icon name={isOpen(g()) ? "down" : "right"} size={11} />
                            {groupLabel(g(), new Date(now()))} <em>{g().items.length}</em>
                          </button>
                          <Show when={isOpen(g())}>
                            <For each={shownItems(g()).map((i) => i.id)}>
                              {(id) => (
                                <Show when={ideaById().get(id)}>
                                  {(idea) => (
                                    <Show when={openId() === id} fallback={ideaRow(idea)}>
                                      <div
                                        id={`idea-row-${id}`}
                                        class="ix"
                                        classList={{
                                          "is-sel": selected().has(id),
                                          "is-primary": primary() === id,
                                          "is-used": !!idea().used_at,
                                        }}
                                        role="group"
                                        aria-label={idea().title}
                                      >
                                        <IdeaEditor
                                          ideaId={id}
                                          ideas={ideas()}
                                          folders={folders() ?? []}
                                          scripts={scripts()}
                                          now={now()}
                                          onReady={(h) => (editor = h)}
                                          onDispose={(h) => {
                                            if (editor === h) editor = null;
                                          }}
                                          onConvert={(i) => void convert(i)}
                                          onDelete={(i) => void removeIdeas([i])}
                                          onMove={(i, fid) => void moveIdeas([i], fid)}
                                          onOpenScript={(sid, title) => navStore.openScript(sid, title)}
                                          onSelectIdea={revealIdea}
                                          onCollapse={closeRow}
                                        />
                                      </div>
                                    </Show>
                                  )}
                                </Show>
                              )}
                            </For>
                          </Show>
                        </>
                      )}
                    </Show>
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

          <div class="i-keys">
            {keyHint("↑ ↓", t("ideasPage.keys.select"))} ·{" "}
            {keyHint("⏎", t("ideasPage.keys.open"))} ·{" "}
            {keyHint("esc", t("ideasPage.keys.close"))} ·{" "}
            {keyHint(K("Mod+Enter"), t("ideasPage.keys.convert"))} ·{" "}
            {keyHint("⌫", t("ideasPage.keys.delete"))} ·{" "}
            <kbd>{K("Shift")}</kbd>
            {t("ideasPage.keys.multi")}
          </div>
        </div>
      </div>

      <HandoffDialog
        open={handoffOpen()}
        scriptIds={[]}
        ideaIds={[...selected()]}
        onClose={() => setHandoffOpen(false)}
        onSent={() => {
          setHandoffOpen(false);
          selectOnly(primary());
          ideasStore.refresh();
        }}
      />
    </div>
  );
}

export default IdeasPage;
