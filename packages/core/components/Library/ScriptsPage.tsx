import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import type { ScriptStatus, ScriptSummary, SearchHit } from "../../lib/types";
import { SCRIPT_STATUSES } from "../../lib/types";
import { api } from "../../lib/api";
import { debounce, relativeTime } from "../../lib/format";
import { formatClock, formatRange, resolveLengthRange } from "../../lib/lengthGoal";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { K } from "../../lib/keys";
import { tryParseConnectCode } from "../../lib/handoff";
import { exportScriptsToPdf } from "../../lib/exportSelection";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { settingsStore } from "../../stores/settings";
import { dailyStatsStore } from "../../stores/dailyStats";
import { ideasStore } from "../../stores/ideas";
import { pushToast } from "../../stores/toasts";
import { getCurrentLocale, localeCompare, t, tPlural } from "../../i18n";
import { Icon } from "../Common/Icon";
import { StageGlyph } from "../Common/StageGlyph";
import { safeSnippet } from "../Palette/snippet";
import {
  defaultLengthRange,
  folderColor,
  isoWeekStart,
  library,
  runtimeSecFor,
} from "../Shell/libraryData";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { HandoffDialog } from "./HandoffDialog";
import { PageBar } from "./PageBar";
import { PromptDialog } from "./PromptDialog";
import { ScriptRow } from "./ScriptRow";
import { SelectionBar } from "./SelectionBar";
import { libraryPrefs, type Grouping, type SortKey } from "./prefs";
import { setStageWithUndo } from "../Script/stageActions";
import {
  archiveScripts,
  createFolder,
  createScript,
  currentFolderContext,
  duplicateScript,
  importScriptzFile,
  moveScriptsTo,
  renameScript,
  setScriptsStage,
} from "./actions";
import "./Library.css";

const PAGE_SIZE = 200;
/** Placeholder for the number inside a translated sentence, so the number
 *  can be rendered bold without putting markup into the catalog. */
const MARK = "\u0000";

function boldCount(text: string, display: string): JSX.Element {
  const [a, b] = text.split(MARK);
  return (
    <>
      {a}
      <b class="num">{display}</b>
      {b ?? ""}
    </>
  );
}

interface Group {
  key: string;
  label: string;
  glyph: () => JSX.Element;
  status?: ScriptStatus;
  /** All matching scripts of the group (counts, material sum). */
  all: ScriptSummary[];
  /** The rows currently rendered (pagination). */
  items: ScriptSummary[];
}

type Block =
  | { kind: "group"; group: Group }
  | { kind: "closed"; groups: Group[] }
  | { kind: "teaser" };

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  align?: "start" | "end";
  placement?: "below" | "above";
  width?: number;
}

function sortScripts(list: ScriptSummary[], key: SortKey): ScriptSummary[] {
  const out = [...list];
  if (key === "title") out.sort((a, b) => localeCompare(a.title, b.title));
  else if (key === "created") out.sort((a, b) => b.created_at - a.created_at);
  else out.sort((a, b) => b.updated_at - a.updated_at);
  return out;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  );
}

function modalOpen(): boolean {
  return uiStore.anyDialogOpen() || document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * "Übersicht" (concept screen 1): every script of the current scope
 * (all / one stage / one folder), grouped by stage, folder or not at all,
 * with the week line, a filter, the ideas teaser, row actions, selection
 * mode and the import / folder operations of the old browser.
 */
export function ScriptsPage() {
  const route = () => {
    const r = navStore.route();
    return r.kind === "scripts" ? r : null;
  };
  const status = (): ScriptStatus | null => route()?.status ?? null;
  const folderId = (): string | null => route()?.folderId ?? null;
  const isAll = () => status() === null && folderId() === null;

  // Normally already loaded during boot (AppShell); a no-op then.
  onMount(() => void libraryPrefs.load());

  // ---- filter ----
  const [filter, setFilter] = createSignal("");
  const [query, setQuery] = createSignal("");
  const applyQuery = debounce((v: string) => setQuery(v), 160);
  onCleanup(() => applyQuery.cancel());
  const needle = () => query().trim().toLowerCase();
  let filterRef: HTMLInputElement | undefined;

  // ---- selection ----
  const [selectMode, setSelectMode] = createSignal(false);
  const [selected, setSelected] = createSignal<Set<string>>(new Set());
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set<string>());
  };
  const toggleSelect = (id: string) => {
    setSelectMode(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- pagination ----
  const [limit, setLimit] = createSignal(PAGE_SIZE);

  // A new scope starts clean: no filter, no selection, first page.
  createEffect(
    on(
      () => [status(), folderId()] as const,
      () => {
        applyQuery.cancel();
        setFilter("");
        setQuery("");
        exitSelect();
        setLimit(PAGE_SIZE);
      },
      { defer: true },
    ),
  );
  createEffect(on([query, libraryPrefs.sort], () => setLimit(PAGE_SIZE), { defer: true }));

  // ---- data ----
  const scope = createMemo(() => {
    const st = status();
    const fid = folderId();
    return library.scripts().filter((s) => {
      if (st && s.status !== st) return false;
      if (fid === INBOX_FOLDER_ID) return s.folder_id === null;
      if (fid) return s.folder_id === fid;
      return true;
    });
  });

  const matches = createMemo(() => {
    const n = needle();
    if (!n) return scope();
    return scope().filter(
      (s) =>
        s.title.toLowerCase().includes(n) ||
        s.characters.some((c) => c.name.toLowerCase().includes(n)),
    );
  });

  const sorted = createMemo(() => sortScripts(matches(), libraryPrefs.sort()));
  const visible = createMemo(() => sorted().slice(0, limit()));
  const hasMore = () => sorted().length > limit();

  // Full-text hits for the filter: content matches that the title filter
  // didn't catch, restricted to the current scope.
  const [rawHits, setRawHits] = createSignal<SearchHit[]>([]);
  let searchSeq = 0;
  createEffect(
    on(query, (raw) => {
      const v = raw.trim();
      const seq = ++searchSeq;
      if (v.length < 2) {
        setRawHits([]);
        return;
      }
      api
        .globalSearch(v, 50)
        .then((hits) => {
          if (seq === searchSeq) setRawHits(hits);
        })
        .catch(() => {
          if (seq === searchSeq) setRawHits([]);
        });
    }),
  );
  const contentHits = createMemo(() => {
    if (!needle()) return [];
    const titleIds = new Set(matches().map((s) => s.id));
    const inScope = new Map(scope().map((s) => [s.id, s] as const));
    const out: { script: ScriptSummary; snippet: string }[] = [];
    for (const h of rawHits()) {
      const s = inScope.get(h.id);
      if (!s || titleIds.has(h.id)) continue;
      out.push({ script: s, snippet: h.snippet ? safeSnippet(h.snippet) : "" });
    }
    return out;
  });

  // ---- groups ----
  const groups = createMemo<Group[]>(() => {
    const g: Grouping = libraryPrefs.grouping();
    const all = sorted();
    const shown = visible();
    if (g === "stage") {
      return SCRIPT_STATUSES.map((st) => ({
        key: st,
        label: t(`stage.${st}`),
        glyph: () => <StageGlyph stage={st} />,
        status: st,
        all: all.filter((s) => s.status === st),
        items: shown.filter((s) => s.status === st),
      })).filter((grp) => grp.all.length > 0);
    }
    if (g === "folder") {
      const out: Group[] = library.folders().map((f) => ({
        key: `folder:${f.id}`,
        label: f.name,
        glyph: () => <span class="fdot" style={{ background: folderColor(f.id) }} />,
        all: all.filter((s) => s.folder_id === f.id),
        items: shown.filter((s) => s.folder_id === f.id),
      }));
      out.push({
        key: "folder:none",
        label: t("folder.none"),
        glyph: () => <Icon name="folder" size={13} />,
        all: all.filter((s) => s.folder_id === null || !library.folder(s.folder_id)),
        items: shown.filter((s) => s.folder_id === null || !library.folder(s.folder_id)),
      });
      return out.filter((grp) => grp.all.length > 0);
    }
    return [{ key: "all", label: "", glyph: () => null, all, items: shown }];
  });

  // Collapsing only applies to the unfiltered, multi-group views.
  const canCollapse = () =>
    libraryPrefs.grouping() !== "none" && !needle() && status() === null;
  const isClosed = (key: string) => canCollapse() && libraryPrefs.isCollapsed(key);

  const showTeaser = () => isAll() && !needle() && library.openIdeas().length > 0;

  const blocks = createMemo<Block[]>(() => {
    const out: Block[] = [];
    const list = groups();
    let teaserPlaced = !showTeaser();
    if (!teaserPlaced && libraryPrefs.grouping() !== "stage") {
      out.push({ kind: "teaser" });
      teaserPlaced = true;
    }
    for (const grp of list) {
      // Stage view: the teaser sits between the work in progress (writing,
      // ready) and what's done (shot, online).
      if (!teaserPlaced && (grp.status === "shot" || grp.status === "online")) {
        out.push({ kind: "teaser" });
        teaserPlaced = true;
      }
      if (isClosed(grp.key)) {
        const last = out[out.length - 1];
        if (last && last.kind === "closed") last.groups.push(grp);
        else out.push({ kind: "closed", groups: [grp] });
      } else {
        out.push({ kind: "group", group: grp });
      }
    }
    if (!teaserPlaced) out.push({ kind: "teaser" });
    return out;
  });

  // ---- header ----
  const folderName = () => {
    const fid = folderId();
    if (fid === INBOX_FOLDER_ID) return t("folder.inbox");
    return library.folder(fid)?.name ?? "";
  };
  const pageTitle = () => {
    const st = status();
    if (st) return t(`stage.${st}`);
    if (folderId()) return folderName() || t("shell.nav.all");
    return t("shell.nav.all");
  };

  const week = createMemo(() => {
    const start = isoWeekStart();
    const shot = library
      .scripts()
      .filter((s) => s.status === "shot" && (s.status_changed_at ?? 0) >= start).length;
    const words = dailyStatsStore.stats().wordsThisWeek;
    const ideas = (ideasStore.ideas() ?? []).filter((i) => i.created_at >= start).length;
    return { shot, words, ideas };
  });
  const fmtNum = (n: number) => n.toLocaleString(getCurrentLocale());

  const folderRange = () => {
    const f = library.folder(folderId());
    if (!f) return "";
    return formatRange(resolveLengthRange(f, defaultLengthRange()));
  };

  // ---- menus ----
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const menuAt = (anchor: HTMLElement, items: ContextMenuItem[], opts: Partial<MenuState> = {}) => {
    const r = anchor.getBoundingClientRect();
    const above = opts.placement === "above";
    setMenu({
      x: opts.align === "start" ? r.left : r.right,
      y: above ? r.top - 6 : r.bottom + 6,
      align: opts.align ?? "end",
      placement: opts.placement,
      items,
      width: opts.width,
    });
  };

  const [renameTarget, setRenameTarget] = createSignal<ScriptSummary | null>(null);
  const [newFolderFor, setNewFolderFor] = createSignal<string[] | null>(null);
  const [handoffOpen, setHandoffOpen] = createSignal(false);

  const studioConnected = createMemo(
    () => tryParseConnectCode(settingsStore.studioConnectCode()) !== null,
  );

  function moveItems(ids: string[], current: string | null | undefined): ContextMenuItem[] {
    const single = ids.length === 1;
    const items: ContextMenuItem[] = [
      {
        label: t("folder.none"),
        checked: single && current === null,
        disabled: single && current === null,
        onClick: () => void moveScriptsTo(ids, null),
      },
    ];
    for (const f of library.folders()) {
      items.push({
        label: f.name,
        icon: <span class="fdot" style={{ background: folderColor(f.id) }} />,
        checked: single && current === f.id,
        disabled: single && current === f.id,
        onClick: () => void moveScriptsTo(ids, f.id),
      });
    }
    items.push({
      label: t("folder.newDots"),
      icon: "plus",
      separatorBefore: true,
      onClick: () => setNewFolderFor(ids),
    });
    return items;
  }

  function stageItems(ids: string[], current?: ScriptStatus): ContextMenuItem[] {
    return SCRIPT_STATUSES.map((st, i) => ({
      label: t(`stage.${st}`),
      icon: <StageGlyph stage={st} />,
      checked: current === st,
      hint: String(i + 1),
      // One script: undo toast (shared with the script screen); several:
      // a plain confirmation.
      onClick: () => void (ids.length === 1 ? setStageWithUndo(ids[0], st) : setScriptsStage(ids, st)),
    }));
  }

  function rowItems(s: ScriptSummary): ContextMenuItem[] {
    return [
      { label: t("script.menu.open"), icon: "return", onClick: () => navStore.openScript(s.id, s.title) },
      { label: t("script.menu.rename"), icon: "pen", onClick: () => setRenameTarget(s) },
      { label: t("script.menu.duplicate"), icon: "doc", onClick: () => void duplicateScript(s) },
      { label: t("script.menu.move"), icon: "folder", children: moveItems([s.id], s.folder_id) },
      {
        label: t("shell.menu.stage"),
        icon: <StageGlyph stage={s.status} />,
        children: stageItems([s.id], s.status),
      },
      {
        label: t("shell.menu.exportPdf"),
        icon: "export",
        separatorBefore: true,
        onClick: () => uiStore.openExport(s.id),
      },
      {
        label: t("shell.menu.trash"),
        icon: "trash",
        danger: true,
        separatorBefore: true,
        onClick: () => void archiveScripts([s]),
      },
    ];
  }

  function openRowMenu(s: ScriptSummary, e: MouseEvent, anchor?: HTMLElement) {
    if (anchor) menuAt(anchor, rowItems(s));
    else setMenu({ x: e.clientX, y: e.clientY, items: rowItems(s) });
  }

  const groupingLabel = (g: Grouping) =>
    g === "stage"
      ? t("shell.group.byStage")
      : g === "folder"
        ? t("shell.group.byFolder")
        : t("shell.group.none");

  const groupingItems = (): ContextMenuItem[] =>
    (["stage", "folder", "none"] as const).map((g) => ({
      label: g === "stage" ? t("shell.group.stage") : g === "folder" ? t("shell.group.folder") : t("shell.group.off"),
      checked: libraryPrefs.grouping() === g,
      onClick: () => libraryPrefs.setGrouping(g),
    }));

  const sortItems = (): ContextMenuItem[] =>
    (["updated", "created", "title"] as const).map((k) => ({
      label: t(`browser.sort.${k}`),
      checked: libraryPrefs.sort() === k,
      onClick: () => libraryPrefs.setSort(k),
    }));

  const moreItems = (): ContextMenuItem[] => [
    { label: t("browser.import.title"), icon: "import", onClick: () => void importScriptzFile() },
    { label: t("browser.canvas.newFolder"), icon: "folder", onClick: () => setNewFolderFor([]) },
    {
      label: t("browser.trash"),
      icon: "trash",
      separatorBefore: true,
      onClick: () => navStore.go({ kind: "trash" }),
    },
  ];

  // ---- selection actions ----
  const selectedScripts = () => {
    const ids = selected();
    return library.scripts().filter((s) => ids.has(s.id));
  };

  async function exportSelectedPdf() {
    const ids = [...selected()];
    if (ids.length === 0) {
      pushToast(t("select.empty"), "info");
      return;
    }
    try {
      const res = await exportScriptsToPdf(ids, { includeHighlighting: false, includeTitlePage: true });
      if (res.cancelled) return;
      pushToast(tPlural("select.pdf.toast", res.count), "ok");
    } catch (e) {
      pushToast(t("select.pdf.failed", { message: (e as Error).message ?? String(e) }), "error");
    }
  }

  // ---- keyboard: "/" focuses the filter, Esc leaves the selection ----
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen() || menu()) return;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        filterRef?.focus();
        filterRef?.select();
        return;
      }
      if (e.key === "Escape" && selectMode() && !isTypingTarget(e.target)) {
        e.preventDefault();
        exitSelect();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Drop selected ids that vanished (trashed, sent to Studio, ...).
  createEffect(() => {
    const live = new Set(library.scripts().map((s) => s.id));
    const cur = selected();
    if ([...cur].some((id) => !live.has(id))) {
      setSelected(new Set([...cur].filter((id) => live.has(id))));
    }
  });

  const newScriptHere = () => void createScript(currentFolderContext());

  const libraryEmpty = () => library.loaded() && library.scripts().length === 0;
  const nothingFound = () => needle() !== "" && matches().length === 0 && contentHits().length === 0;
  const scopeEmpty = () => library.loaded() && scope().length === 0;

  const renderRows = (items: ScriptSummary[]) => (
    <div class="rows">
      <For each={items}>
        {(s) => (
          <ScriptRow
            script={s}
            selectMode={selectMode()}
            selected={selected().has(s.id)}
            onOpen={() => navStore.openScript(s.id, s.title)}
            onToggleSelect={() => toggleSelect(s.id)}
            onMenu={(e, anchor) => openRowMenu(s, e, anchor)}
          />
        )}
      </For>
    </div>
  );

  const groupAction = (grp: Group) => {
    if (grp.status === "writing" && !selectMode()) {
      return (
        <button type="button" class="grp-act" onClick={newScriptHere}>
          <Icon name="plus" size={12} />
          {t("browser.newScript")}
        </button>
      );
    }
    if (grp.status === "ready") {
      const sum = grp.all.reduce((acc, s) => acc + (runtimeSecFor(s) ?? 0), 0);
      if (sum <= 0) return null;
      return (
        <span class="grp-act is-static" title={t("shell.group.materialTitle")}>
          {t("shell.group.material", { time: formatClock(sum) })}
        </span>
      );
    }
    return null;
  };

  return (
    <div class="lib-page">
      <PageBar title={pageTitle()}>
        <button
          type="button"
          class="btn ghost"
          aria-haspopup="menu"
          onClick={(e) => menuAt(e.currentTarget, groupingItems(), { width: 200 })}
        >
          {groupingLabel(libraryPrefs.grouping())}
          <Icon name="down" size={12} />
        </button>
        <button
          type="button"
          class="btn ghost"
          aria-haspopup="menu"
          title={t("shell.sort.title")}
          onClick={(e) => menuAt(e.currentTarget, sortItems(), { width: 180 })}
        >
          {t(`browser.sort.${libraryPrefs.sort()}`)}
          <Icon name="down" size={12} />
        </button>
        <button
          type="button"
          class="btn ghost"
          classList={{ "is-on": selectMode() }}
          aria-pressed={selectMode()}
          disabled={scope().length === 0}
          onClick={() => (selectMode() ? exitSelect() : setSelectMode(true))}
        >
          <Icon name="select" />
          {t("select.enter")}
        </button>
        <button
          type="button"
          class="btn ghost icon"
          aria-haspopup="menu"
          title={t("shell.more")}
          aria-label={t("shell.more")}
          onClick={(e) => menuAt(e.currentTarget, moreItems())}
        >
          <Icon name="dots" />
        </button>
      </PageBar>

      <div class="lib-scroll" classList={{ "has-selbar": selectMode() }}>
        <div class="lib">
          <div class="lib-head">
            <div class="lib-head-main">
              <h1>{pageTitle()}</h1>
              <Switch>
                <Match when={isAll()}>
                  <Show when={week().shot + week().words + week().ideas > 0}>
                    <div class="week">
                      <span class="week-lbl">{t("shell.week.label")}</span>
                      <Show when={week().shot > 0}>
                        <span>
                          <StageGlyph stage="shot" />
                          {boldCount(tPlural("shell.week.shot", week().shot, { count: MARK }), fmtNum(week().shot))}
                        </span>
                      </Show>
                      <Show when={week().words > 0}>
                        <span>
                          {boldCount(tPlural("shell.week.words", week().words, { count: MARK }), fmtNum(week().words))}
                        </span>
                      </Show>
                      <Show when={week().ideas > 0}>
                        <span>
                          <StageGlyph stage="idea" />
                          {boldCount(tPlural("shell.week.ideas", week().ideas, { count: MARK }), fmtNum(week().ideas))}
                        </span>
                      </Show>
                    </div>
                  </Show>
                </Match>
                <Match when={!isAll()}>
                  <div class="week">
                    <span class="week-lbl">{tPlural("units.scripts", scope().length)}</span>
                    <Show when={folderId() && folderId() !== INBOX_FOLDER_ID}>
                      <button
                        type="button"
                        class="week-btn"
                        title={t("shell.folder.rangeTitle")}
                        onClick={() => uiStore.openSettings("folders")}
                      >
                        {folderRange()
                          ? t("shell.folder.range", { range: folderRange() })
                          : t("shell.folder.rangeNone")}
                      </button>
                    </Show>
                  </div>
                </Match>
              </Switch>
            </div>
            <label class="field-box lib-filter">
              <Icon name="search" size={13} />
              <input
                ref={filterRef}
                type="text"
                value={filter()}
                placeholder={t("shell.filter.placeholder")}
                aria-label={t("shell.filter.placeholder")}
                spellcheck={false}
                onInput={(e) => {
                  setFilter(e.currentTarget.value);
                  applyQuery(e.currentTarget.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    if (filter()) {
                      applyQuery.cancel();
                      setFilter("");
                      setQuery("");
                    } else {
                      e.currentTarget.blur();
                    }
                  }
                }}
              />
              <Show when={filter()} fallback={<kbd>/</kbd>}>
                <button
                  type="button"
                  class="lib-filter-x"
                  aria-label={t("shell.filter.clear")}
                  title={t("shell.filter.clear")}
                  onClick={() => {
                    applyQuery.cancel();
                    setFilter("");
                    setQuery("");
                    filterRef?.focus();
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </Show>
            </label>
          </div>

          <Switch>
            <Match when={!library.loaded()}>
              <div class="lib-loading" />
            </Match>
            <Match when={libraryEmpty() && isAll() && !needle()}>
              <div class="lib-empty">
                <div class="lib-empty-h">{t("shell.empty.first.title")}</div>
                <div class="lib-empty-sub">
                  {(() => {
                    const [a, b] = t("shell.empty.first.body").split("{key}");
                    return (
                      <>
                        {a}
                        <kbd>{K("Mod+N")}</kbd>
                        {b ?? ""}
                      </>
                    );
                  })()}
                </div>
                <button type="button" class="btn primary" onClick={newScriptHere}>
                  <Icon name="plus" />
                  {t("browser.newScript")}
                </button>
              </div>
              <Show when={showTeaser()}>
                <IdeasTeaser />
              </Show>
            </Match>
            <Match when={nothingFound()}>
              <div class="lib-empty">
                <div class="lib-empty-h">{t("browser.empty.search.title", { query: query().trim() })}</div>
                <div class="lib-empty-sub">{t("shell.empty.search.hint")}</div>
              </div>
            </Match>
            <Match when={scopeEmpty() && !needle()}>
              <div class="lib-empty">
                <Show
                  when={status()}
                  fallback={
                    <>
                      <div class="lib-empty-h">{t("browser.empty.folder.title", { folder: folderName() })}</div>
                      <div class="lib-empty-sub">{t("shell.empty.folder.hint")}</div>
                      <button type="button" class="btn" onClick={newScriptHere}>
                        <Icon name="plus" />
                        {t("browser.newScript")}
                      </button>
                    </>
                  }
                >
                  {(st) => (
                    <>
                      <div class="lib-empty-h">{t("shell.empty.stage.title", { stage: t(`stage.${st()}`) })}</div>
                      <div class="lib-empty-sub">{t("shell.empty.stage.hint")}</div>
                    </>
                  )}
                </Show>
              </div>
            </Match>
            <Match when={true}>
              <For each={blocks()}>
                {(block) => (
                  <Switch>
                    <Match when={block.kind === "teaser"}>
                      <IdeasTeaser />
                    </Match>
                    <Match when={block.kind === "closed" && block}>
                      {(b) => (
                        <div class="grp is-closed">
                          <div class="grp-h">
                            <For each={(b() as { kind: "closed"; groups: Group[] }).groups}>
                              {(grp, i) => (
                                <button
                                  type="button"
                                  class="grp-tog"
                                  aria-expanded="false"
                                  title={t("shell.group.expand")}
                                  onClick={() => libraryPrefs.toggleCollapsed(grp.key)}
                                >
                                  <Show when={i() === 0}>
                                    <Icon name="right" size={11} class="chev is-shown" />
                                  </Show>
                                  {grp.glyph()}
                                  <span>{grp.label}</span>
                                  <span class="n num">{grp.all.length}</span>
                                </button>
                              )}
                            </For>
                            <span class="grp-act is-static">{t("shell.group.collapsed")}</span>
                          </div>
                        </div>
                      )}
                    </Match>
                    <Match when={block.kind === "group" && block}>
                      {(b) => {
                        const grp = () => (b() as { kind: "group"; group: Group }).group;
                        return (
                          <section class="grp">
                            <Show when={grp().key !== "all"}>
                              <div class="grp-h">
                                <button
                                  type="button"
                                  class="grp-tog"
                                  aria-expanded="true"
                                  disabled={!canCollapse()}
                                  title={canCollapse() ? t("shell.group.collapse") : undefined}
                                  onClick={() => libraryPrefs.toggleCollapsed(grp().key)}
                                >
                                  <Show when={canCollapse()}>
                                    <Icon name="down" size={11} class="chev" />
                                  </Show>
                                  {grp().glyph()}
                                  <span>{grp().label}</span>
                                  <span class="n num">{grp().all.length}</span>
                                </button>
                                <span class="grp-sp" />
                                {groupAction(grp())}
                              </div>
                            </Show>
                            <Show when={grp().items.length > 0}>{renderRows(grp().items)}</Show>
                          </section>
                        );
                      }}
                    </Match>
                  </Switch>
                )}
              </For>

              <Show when={hasMore()}>
                <div class="lib-more">
                  <button type="button" class="btn ghost" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
                    {t("browser.loadMore", { n: Math.min(PAGE_SIZE, sorted().length - limit()) })}
                  </button>
                </div>
              </Show>

              <Show when={contentHits().length > 0}>
                <section class="grp">
                  <div class="grp-h">
                    <span class="grp-tog is-static">
                      <Icon name="search" size={12} />
                      <span>{t("shell.group.contentHits")}</span>
                      <span class="n num">{contentHits().length}</span>
                    </span>
                  </div>
                  <div class="rows">
                    <For each={contentHits()}>
                      {(hit) => (
                        <ScriptRow
                          script={hit.script}
                          snippetHtml={hit.snippet}
                          selectMode={selectMode()}
                          selected={selected().has(hit.script.id)}
                          onOpen={() => navStore.openScript(hit.script.id, hit.script.title)}
                          onToggleSelect={() => toggleSelect(hit.script.id)}
                          onMenu={(e, anchor) => openRowMenu(hit.script, e, anchor)}
                        />
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </Match>
          </Switch>
        </div>
      </div>

      <Show when={selectMode()}>
        <SelectionBar
          count={selected().size}
          onSelectAll={() => setSelected(new Set(sorted().map((s) => s.id)))}
          onClear={() => setSelected(new Set<string>())}
          onExit={exitSelect}
          onExportPdf={() => void exportSelectedPdf()}
          onSend={studioConnected() ? () => setHandoffOpen(true) : undefined}
          onMove={(anchor) =>
            menuAt(anchor, moveItems([...selected()], undefined), { placement: "above", align: "start" })
          }
          onStage={(anchor) =>
            menuAt(anchor, stageItems([...selected()]), { placement: "above", align: "start", width: 200 })
          }
          onTrash={() => {
            const list = selectedScripts();
            exitSelect();
            void archiveScripts(list);
          }}
        />
      </Show>

      <Show when={menu()}>
        {(m) => (
          <ContextMenu
            x={m().x}
            y={m().y}
            align={m().align}
            placement={m().placement}
            width={m().width}
            items={m().items}
            onClose={() => setMenu(null)}
          />
        )}
      </Show>

      <PromptDialog
        open={renameTarget() !== null}
        title={t("script.renameTitle")}
        label={t("script.titleLabel")}
        initialValue={renameTarget()?.title ?? ""}
        submitLabel={t("common.save")}
        emptyHint={t("script.renameEmptyHint")}
        hint={renameTarget() ? t("common.current", { value: renameTarget()!.title }) : undefined}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (v) => {
          const target = renameTarget();
          if (target && (await renameScript(target, v))) setRenameTarget(null);
        }}
      />

      <PromptDialog
        open={newFolderFor() !== null}
        title={t("folder.createTitle")}
        label={t("common.name")}
        initialValue=""
        placeholder={t("folder.placeholder")}
        submitLabel={t("folder.createSubmit")}
        onClose={() => setNewFolderFor(null)}
        onSubmit={async (v) => {
          const ids = newFolderFor() ?? [];
          const created = await createFolder(v);
          if (!created) return;
          setNewFolderFor(null);
          if (ids.length > 0) await moveScriptsTo(ids, created.id);
        }}
      />

      <HandoffDialog
        open={handoffOpen()}
        scriptIds={[...selected()]}
        ideaIds={[]}
        onClose={() => setHandoffOpen(false)}
        onSent={() => exitSelect()}
      />
    </div>
  );
}

/** "48 Ideen warten" card (only on the unfiltered "Alle Skripte" view). */
function IdeasTeaser() {
  const newest = createMemo(() => {
    const list = library.openIdeas();
    let best = list[0];
    for (const i of list) if (i.created_at > (best?.created_at ?? 0)) best = i;
    return best;
  });
  return (
    <button type="button" class="teaser" onClick={() => navStore.openIdeas()}>
      <StageGlyph stage="idea" class="teaser-glyph" />
      <div>
        <b>{tPlural("shell.teaser.waiting", library.openIdeas().length)}</b>
        <Show when={newest()}>
          {(i) => (
            <span>
              {t("shell.teaser.newest", { title: i().title, when: relativeTime(i().created_at) })}
            </span>
          )}
        </Show>
      </div>
      <span class="btn sm">
        {t("shell.teaser.open")}
        <Icon name="right" size={12} />
      </span>
    </button>
  );
}

export default ScriptsPage;
