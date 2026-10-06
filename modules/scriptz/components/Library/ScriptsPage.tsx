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
import type { Idea, ScriptStatus, ScriptSummary, SearchHit } from "../../lib/types";
import { finalStageId, firstStageId, isFinalStage, isKnownStage, scriptStages, stageIndex, stageLabel } from "../../lib/stages";
import { api } from "../../lib/api";
import { debounce, relativeTime } from "@agentz/kit/lib";
import { formatClock, formatRange, resolveLengthRange } from "../../lib/lengthGoal";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { K, isModKey } from "@agentz/kit/platform";
import { exportScriptsToPdf } from "../../lib/exportSelection";
import { navStore } from "../../stores/nav";
import { openScriptFromList, peekStore } from "../../stores/peek";
import { openScriptAnimated } from "../Common/motion";

/** Full script view, growing out of the clicked row (motion.tsx). */
function openFull(id: string, title?: string): void {
  openScriptAnimated(() => navStore.openScript(id, title));
}

/** Click in a list: side panel or full view, as the setting says. */
function openFromList(id: string, title: string | undefined, inverse: boolean): void {
  if (settingsStore.openInPanel() !== inverse) openScriptFromList(id, title, inverse);
  else openFull(id, title);
}
import { uiStore } from "../../stores/ui";
import { settingsStore } from "../../stores/settings";
import { dailyStatsStore } from "../../stores/dailyStats";
import { ideasStore } from "../../stores/ideas";
import { pushToast } from "@agentz/kit/stores";
import { getCurrentLocale, localeCompare } from "@agentz/kit/i18n";
import { t, tPlural } from "../../i18n";
import { Icon } from "@agentz/kit/ui";
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
import { Board, type BoardColumn } from "./Board";
import { InboxIdeas, openIdea } from "./InboxIdeas";
import { PeekPanel } from "./PeekPanel";
import { PageBar } from "./PageBar";
import { PromptDialog } from "./PromptDialog";
import { ScriptRow } from "./ScriptRow";
import { SelectionBar } from "./SelectionBar";
import { SelectAllLine, SelectCheck } from "./SelectCheck";
import { checkState, rangeBetween, toggleIds, withIds } from "./selection";
import { libraryPrefs, type Grouping, type SortKey, type ViewMode, type ViewScope } from "./prefs";
import { setStageWithUndo } from "../Script/stageActions";
import {
  archiveScripts,
  createFolder,
  currentFolderContext,
  duplicateScript,
  importScriptzFile,
  moveScriptsTo,
  openNewScript,
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
 * "Übersicht": every script of the current scope
 * (all / one stage / one folder / the inbox), grouped by stage, folder or not at all,
 * with the week line, a filter, the ideas teaser, row actions, selection
 * mode and the import / folder operations.
 */
export function ScriptsPage() {
  const route = () => {
    const r = navStore.route();
    return r.kind === "scripts" ? r : null;
  };
  // A filter on a stage that was removed in the settings falls back to all.
  const status = (): ScriptStatus | null => {
    const st = route()?.status;
    return st && isKnownStage(st) ? st : null;
  };
  const folderId = (): string | null => route()?.folderId ?? null;
  /** Inbox: open ideas plus every script before the last stage. */
  const isInbox = () => navStore.route().kind === "inbox";
  const isAll = () => !isInbox() && status() === null && folderId() === null;
  /** Pages with a board; a single stage is always a list. */
  const viewScope = (): ViewScope | null => {
    if (isInbox()) return "inbox";
    if (status() !== null) return null;
    return folderId() === null ? "all" : "folder";
  };
  const isBoard = () => {
    const scope = viewScope();
    return scope !== null && libraryPrefs.viewMode(scope) === "board";
  };

  // Normally already loaded during module setup; a no-op then.
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
  /** Last toggled row: start of a shift-click range. */
  let rangeAnchor: string | null = null;
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set<string>());
    rangeAnchor = null;
  };
  const toggleSelect = (id: string, e?: MouseEvent | KeyboardEvent) => {
    const wasSelecting = selectMode();
    setSelectMode(true);
    // Shift-click inside the selection mode adds the whole range from the
    // last toggled row, in display order.
    const range =
      wasSelecting && e?.shiftKey && rangeAnchor ? rangeBetween(renderedIds(), rangeAnchor, id) : null;
    if (range) setSelected((prev) => withIds(prev, range, true));
    else setSelected((prev) => toggleIds(prev, [id]));
    rangeAnchor = id;
  };

  // ---- pagination ----
  const [limit, setLimit] = createSignal(PAGE_SIZE);

  // A new scope starts clean: no filter, no selection, first page.
  createEffect(
    on(
      () => [isInbox(), status(), folderId()] as const,
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
  // A new filter starts a new selection scope. Clear immediately while
  // typing, before the debounced query and full-text results arrive, so
  // bulk actions cannot include rows hidden by the new filter.
  createEffect(on(filter, () => {
    setSelected(new Set<string>());
    rangeAnchor = null;
  }, { defer: true }));

  // ---- data ----
  const scope = createMemo(() => {
    if (isInbox()) return library.inProgress();
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

  /** Open ideas of this page (inbox: all of them, a folder: its own),
   *  filtered like the rows. Ideas have no edit time, so "updated" and
   *  "created" both list the newest first. */
  const scopeIdeas = createMemo<Idea[]>(() => {
    if (status() !== null) return [];
    const fid = folderId();
    const n = needle();
    const list = library.openIdeas().filter((i) => {
      if (fid === INBOX_FOLDER_ID ? i.folder_id !== null : fid !== null && i.folder_id !== fid) return false;
      return !n || i.title.toLowerCase().includes(n) || (i.notes ?? "").toLowerCase().includes(n);
    });
    return libraryPrefs.sort() === "title"
      ? list.sort((a, b) => localeCompare(a.title, b.title))
      : list.sort((a, b) => b.created_at - a.created_at);
  });
  /** The inbox list shows its ideas below the stage groups. */
  const inboxIdeas = () => (isInbox() ? scopeIdeas() : []);

  /** Board: the ideas, then every stage in pipeline order (the inbox
   *  leaves out the last one, like its list). */
  const boardColumns = createMemo<BoardColumn[]>(() => {
    const list = sorted();
    const cols: BoardColumn[] = [
      { key: "idea", stage: null, label: t("shell.nav.ideas"), scripts: [], ideas: scopeIdeas() },
    ];
    for (const { id } of scriptStages()) {
      if (isInbox() && isFinalStage(id)) continue;
      cols.push({ key: id, stage: id, label: stageLabel(id), scripts: list.filter((s) => s.status === id), ideas: [] });
    }
    return cols;
  });
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
      return scriptStages().map(({ id: st }) => ({
        key: st,
        label: stageLabel(st),
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
  // The inbox keeps its own folded groups: "shot" is folded on "Alle
  // Skripte" by default, but in the inbox it's work in progress.
  const collapseKey = (key: string) => (isInbox() ? `inbox:${key}` : key);
  const isClosed = (key: string) => canCollapse() && libraryPrefs.isCollapsed(collapseKey(key));
  const ideasClosed = () => !needle() && libraryPrefs.isCollapsed(collapseKey("ideas"));

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
      // Stage view: the teaser sits between the first half of the pipeline
      // (work in progress) and the second half (default: shot, online).
      if (!teaserPlaced && grp.status && stageIndex(grp.status) >= Math.ceil(scriptStages().length / 2)) {
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

  // ---- selection scope ----
  /** Rows on screen, in display order (shift-click ranges). */
  const renderedIds = createMemo(() => {
    const ids: string[] = [];
    for (const b of blocks()) if (b.kind === "group") for (const s of b.group.items) ids.push(s.id);
    for (const h of contentHits()) ids.push(h.script.id);
    return ids;
  });
  /** What "select all" covers: every match of the current scope and filter
   *  (beyond the loaded page too), except groups the user collapsed. */
  const selectableIds = createMemo(() => {
    const ids: string[] = [];
    for (const grp of groups()) if (!isClosed(grp.key)) for (const s of grp.all) ids.push(s.id);
    for (const h of contentHits()) ids.push(h.script.id);
    return ids;
  });
  const allState = () => checkState(selectableIds(), selected());
  const selectAll = () => setSelected(new Set(selectableIds()));
  const toggleAll = () => (allState() === "all" ? setSelected(new Set<string>()) : selectAll());
  const groupCheck = (label: string, ids: () => string[]) => (
    <Show when={selectMode()}>
      <SelectCheck
        state={checkState(ids(), selected())}
        label={t("select.group", { name: label })}
        onToggle={() => setSelected((prev) => toggleIds(prev, ids()))}
      />
    </Show>
  );

  // ---- header ----
  const folderName = () => {
    const fid = folderId();
    if (fid === INBOX_FOLDER_ID) return t("folder.inbox");
    return library.folder(fid)?.name ?? "";
  };
  const pageTitle = () => {
    if (isInbox()) return t("shell.nav.inbox");
    const st = status();
    if (st) return stageLabel(st);
    if (folderId()) return folderName() || t("shell.nav.all");
    return t("shell.nav.all");
  };

  const week = createMemo(() => {
    const start = isoWeekStart();
    // Scripts that reached the last stage ("done") this week.
    const done = finalStageId();
    const finished = library
      .scripts()
      .filter((s) => s.status === done && (s.status_changed_at ?? 0) >= start).length;
    const words = dailyStatsStore.stats().wordsThisWeek;
    const ideas = (ideasStore.ideas() ?? []).filter((i) => i.created_at >= start).length;
    return { finished, words, ideas };
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
    return scriptStages().map(({ id: st }, i) => ({
      label: stageLabel(st),
      icon: <StageGlyph stage={st} />,
      checked: current === st,
      hint: i < 9 ? String(i + 1) : undefined,
      // One script: undo toast (shared with the script screen); several:
      // a plain confirmation.
      onClick: () => void (ids.length === 1 ? setStageWithUndo(ids[0], st) : setScriptsStage(ids, st)),
    }));
  }

  function rowItems(s: ScriptSummary): ContextMenuItem[] {
    return [
      { label: t("script.menu.open"), icon: "return", onClick: () => openFull(s.id, s.title) },
      { label: t("script.menu.openPanel"), icon: "inspector", onClick: () => peekStore.open(s.id) },
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
      const res = await exportScriptsToPdf(ids, { includeHighlighting: false, includeTitlePage: settingsStore.exportTitlePageDefault(), wpm: settingsStore.dialogWpm() });
      if (res.cancelled) return;
      pushToast(tPlural("select.pdf.toast", res.count), "ok");
    } catch (e) {
      pushToast(t("select.pdf.failed", { message: (e as Error).message ?? String(e) }), "error");
    }
  }

  // ---- keyboard: "/" focuses the filter, ⌘A selects all, Esc leaves the selection ----
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || modalOpen() || menu()) return;
      if (
        isModKey(e) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "a" &&
        !isBoard() &&
        !isTypingTarget(e.target) &&
        selectableIds().length > 0
      ) {
        e.preventDefault();
        setSelectMode(true);
        selectAll();
        return;
      }
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

  // Drop selected ids that left this folder/stage as well as deleted rows.
  // Keep off-page selections: scope() is not limited by pagination.
  createEffect(() => {
    const live = new Set(scope().map((s) => s.id));
    const cur = selected();
    if ([...cur].some((id) => !live.has(id))) {
      setSelected(new Set([...cur].filter((id) => live.has(id))));
    }
  });

  const newScriptHere = () => openNewScript(currentFolderContext());

  const libraryEmpty = () => library.loaded() && library.scripts().length === 0;
  const pageIdeas = () => (isBoard() ? scopeIdeas() : inboxIdeas());
  const nothingFound = () =>
    needle() !== "" && matches().length === 0 && contentHits().length === 0 && pageIdeas().length === 0;
  const scopeEmpty = () => library.loaded() && scope().length === 0 && pageIdeas().length === 0;

  const renderRows = (items: ScriptSummary[]) => (
    <div class="rows">
      <For each={items}>
        {(s) => (
          <ScriptRow
            script={s}
            selectMode={selectMode()}
            selected={selected().has(s.id)}
            peek={peekStore.scriptId() === s.id}
            onOpen={(inverse) => openFromList(s.id, s.title, inverse)}
            onOpenFull={() => openFull(s.id, s.title)}
            onToggleSelect={(e) => toggleSelect(s.id, e)}
            onMenu={(e, anchor) => openRowMenu(s, e, anchor)}
          />
        )}
      </For>
    </div>
  );

  const groupAction = (grp: Group) => {
    if (grp.status === firstStageId() && !selectMode()) {
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

  const setView = (scope: ViewScope, mode: ViewMode) => {
    if (mode === "board") exitSelect();
    libraryPrefs.setViewMode(scope, mode);
  };
  const ViewButton = (p: { mode: ViewMode; scope: ViewScope }) => (
    <button
      type="button"
      aria-pressed={libraryPrefs.viewMode(p.scope) === p.mode}
      onClick={() => setView(p.scope, p.mode)}
    >
      <Icon name={p.mode} size={13} />
      {p.mode === "list" ? t("shell.view.list") : t("shell.view.board")}
    </button>
  );

  return (
    <div class="lib-page" classList={{ "has-peek": peekStore.scriptId() !== null }}>
      <PageBar />

      <div class="lib-scroll" classList={{ "has-selbar": selectMode() }}>
        <div class="lib" classList={{ "is-board": isBoard() }}>
          <div class="lib-head">
            <div class="lib-head-main">
              <h1>{pageTitle()}</h1>
              <Switch>
                <Match when={isAll()}>
                  <Show when={week().finished + week().words + week().ideas > 0}>
                    <div class="week">
                      <span class="week-lbl">{t("shell.week.label")}</span>
                      <Show when={week().finished > 0}>
                        <span>
                          <StageGlyph stage={finalStageId()} />
                          {boldCount(
                            tPlural("shell.week.done", week().finished, { count: MARK, stage: stageLabel(finalStageId()) }),
                            fmtNum(week().finished),
                          )}
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
                <Match when={isInbox()}>
                  <div class="week">
                    <span class="week-lbl">{t("shell.inbox.lead")}</span>
                    <Show when={library.openIdeas().length > 0}>
                      <span>
                        <StageGlyph stage="idea" />
                        {boldCount(
                          tPlural("units.ideas", library.openIdeas().length, { count: MARK }),
                          fmtNum(library.openIdeas().length),
                        )}
                      </span>
                    </Show>
                    <Show when={scope().length > 0}>
                      <span>
                        <Icon name="doc" size={13} />
                        {boldCount(tPlural("units.scripts", scope().length, { count: MARK }), fmtNum(scope().length))}
                      </span>
                    </Show>
                  </div>
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
          </div>

          <div class="lib-tools">
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
            <Show when={viewScope()}>
              {(scope) => (
                <div class="lib-view" role="group" aria-label={t("shell.view.aria")}>
                  <ViewButton mode="list" scope={scope()} />
                  <ViewButton mode="board" scope={scope()} />
                </div>
              )}
            </Show>
            <Show when={!isBoard()}>
              <button
                type="button"
                class="btn ghost"
                aria-haspopup="menu"
                onClick={(e) => menuAt(e.currentTarget, groupingItems(), { width: 200 })}
              >
                {groupingLabel(libraryPrefs.grouping())}
                <Icon name="down" size={12} />
              </button>
            </Show>
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
            <Show when={!isBoard()}>
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
            </Show>
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
                <Switch
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
                  <Match when={isInbox()}>
                    <div class="lib-empty-h">{t("shell.empty.inbox.title")}</div>
                    <div class="lib-empty-sub">
                      {t("shell.empty.inbox.hint", { stage: stageLabel(finalStageId()) })}
                    </div>
                    <button type="button" class="btn" onClick={newScriptHere}>
                      <Icon name="plus" />
                      {t("browser.newScript")}
                    </button>
                  </Match>
                  <Match when={status()}>
                    {(st) => (
                      <>
                        <div class="lib-empty-h">{t("shell.empty.stage.title", { stage: stageLabel(st()) })}</div>
                        <div class="lib-empty-sub">{t("shell.empty.stage.hint")}</div>
                      </>
                    )}
                  </Match>
                </Switch>
              </div>
            </Match>
            <Match when={isBoard()}>
              <Board
                columns={boardColumns()}
                peekId={peekStore.scriptId()}
                showFolder={folderId() === null}
                onOpen={(s, inverse) => openFromList(s.id, s.title, inverse)}
                onOpenIdea={openIdea}
                onMenu={(s, e, anchor) => openRowMenu(s, e, anchor)}
                onNewScript={newScriptHere}
              />
            </Match>
            <Match when={true}>
              <Show when={selectMode() && selectableIds().length > 0}>
                <SelectAllLine state={allState()} count={selectableIds().length} onToggle={toggleAll} />
              </Show>
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
                                  onClick={() => libraryPrefs.toggleCollapsed(collapseKey(grp.key))}
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
                                {groupCheck(grp().label, () => grp().all.map((s) => s.id))}
                                <button
                                  type="button"
                                  class="grp-tog"
                                  aria-expanded="true"
                                  disabled={!canCollapse()}
                                  title={canCollapse() ? t("shell.group.collapse") : undefined}
                                  onClick={() => libraryPrefs.toggleCollapsed(collapseKey(grp().key))}
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

              {/* Work in progress first, the (often long) idea list below it. */}
              <Show when={inboxIdeas().length > 0}>
                <InboxIdeas
                  ideas={inboxIdeas()}
                  closed={ideasClosed()}
                  canCollapse={!needle()}
                  onToggle={() => libraryPrefs.toggleCollapsed(collapseKey("ideas"))}
                />
              </Show>

              <Show when={contentHits().length > 0}>
                <section class="grp">
                  <div class="grp-h">
                    {groupCheck(t("shell.group.contentHits"), () => contentHits().map((h) => h.script.id))}
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
                          peek={peekStore.scriptId() === hit.script.id}
                          onOpen={(inverse) => openFromList(hit.script.id, hit.script.title, inverse)}
                          onOpenFull={() => openFull(hit.script.id, hit.script.title)}
                          onToggleSelect={(e) => toggleSelect(hit.script.id, e)}
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
          allSelected={allState() === "all"}
          onSelectAll={selectAll}
          onClear={() => setSelected(new Set<string>())}
          onExit={exitSelect}
          onExportPdf={() => void exportSelectedPdf()}
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

      <PeekPanel />

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
