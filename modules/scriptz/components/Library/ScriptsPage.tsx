import { Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import type { ScriptStatus, ScriptSummary } from "../../lib/types";
import { finalStageId, isKnownStage, scriptStages, stageLabel } from "../../lib/stages";
import { debounce } from "@agentz/kit/lib";
import { formatRange, resolveLengthRange } from "../../lib/lengthGoal";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { exportScriptsToPdf } from "../../lib/exportSelection";
import { navStore } from "../../stores/nav";
import { peekStore } from "../../stores/peek";
import { openFull, openFromList } from "./openScript";
import { uiStore } from "../../stores/ui";
import { settingsStore } from "../../stores/settings";
import { dailyStatsStore } from "../../stores/dailyStats";
import { ideasStore } from "../../stores/ideas";
import { pushToast } from "@agentz/kit/stores";
import { t, tPlural } from "../../i18n";
import { StageGlyph } from "../Common/StageGlyph";
import { folderColor } from "../Common/folderColor";
import { defaultLengthRange, isoWeekStart, library } from "../Shell/libraryData";
import { ContextMenu, type ContextMenuItem } from "../Common/ContextMenu";
import { Board } from "./Board";
import { openIdea } from "./InboxIdeas";
import { IdeasTeaser } from "./IdeasTeaser";
import { PeekPanel } from "./PeekPanel";
import { PageBar } from "./PageBar";
import { PromptDialog } from "../Common/PromptDialog";
import { SelectionBar } from "../Common/SelectionBar";
import { rangeBetween } from "../Common/selection";
import { createListSelection, isSelectAllKey } from "../Common/listSelection";
import { isTypingTarget } from "../Common/keyboard";
import { libraryPrefs, type ViewMode, type ViewScope } from "./prefs";
import { createScriptsData } from "./scriptsData";
import { ScriptsHeader } from "./ScriptsHeader";
import { ScriptsTools, type ToolsMenuOptions } from "./ScriptsTools";
import { FirstScriptEmpty, NoMatchesEmpty, ScopeEmpty } from "./ScriptsEmpty";
import { ScriptList } from "./ScriptList";
import { setStageWithUndo } from "../Script/stageActions";
import {
  archiveScripts,
  createFolder,
  currentFolderContext,
  duplicateScript,
  moveScriptsTo,
  openNewScript,
  renameScript,
  setScriptsStage,
} from "./actions";
import "./Library.css";

const PAGE_SIZE = 200;

interface MenuState extends ToolsMenuOptions {
  x: number;
  y: number;
  items: ContextMenuItem[];
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
  const clearFilter = () => {
    applyQuery.cancel();
    setFilter("");
    setQuery("");
  };

  // ---- selection ----
  const sel = createListSelection({ selectableIds: () => data.selectableIds() });
  const { selectMode, setSelectMode, selected } = sel;
  /** Last toggled row: start of a shift-click range. */
  let rangeAnchor: string | null = null;
  const exitSelect = () => {
    sel.exit();
    rangeAnchor = null;
  };
  const toggleSelect = (id: string, e?: MouseEvent | KeyboardEvent) => {
    const wasSelecting = selectMode();
    setSelectMode(true);
    // Shift-click inside the selection mode adds the whole range from the
    // last toggled row, in display order.
    const range =
      wasSelecting && e?.shiftKey && rangeAnchor ? rangeBetween(data.renderedIds(), rangeAnchor, id) : null;
    if (range) sel.add(range);
    else sel.toggle([id]);
    rangeAnchor = id;
  };

  // ---- pagination ----
  const [limit, setLimit] = createSignal(PAGE_SIZE);

  // A new scope starts clean: no filter, no selection, first page.
  createEffect(
    on(
      () => [isInbox(), status(), folderId()] as const,
      () => {
        clearFilter();
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
    sel.clear();
    rangeAnchor = null;
  }, { defer: true }));

  // ---- data ----
  const data = createScriptsData({ isInbox, isAll, status, folderId, query, needle, limit });
  const { scope, matches, sorted, scopeIdeas, inboxIdeas, contentHits, showTeaser } = data;

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

  const folderRange = () => {
    const f = library.folder(folderId());
    if (!f) return "";
    return formatRange(resolveLengthRange(f, defaultLengthRange()));
  };

  // ---- menus ----
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const menuAt = (anchor: HTMLElement, items: ContextMenuItem[], opts: ToolsMenuOptions = {}) => {
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
      if (isSelectAllKey(e) && !isBoard() && !isTypingTarget(e.target) && data.selectableIds().length > 0) {
        e.preventDefault();
        sel.selectAll();
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
    sel.retain((id) => live.has(id));
  });

  const newScriptHere = () => openNewScript(currentFolderContext());

  const libraryEmpty = () => library.loaded() && library.scripts().length === 0;
  const pageIdeas = () => (isBoard() ? scopeIdeas() : inboxIdeas());
  const nothingFound = () =>
    needle() !== "" && matches().length === 0 && contentHits().length === 0 && pageIdeas().length === 0;
  const scopeEmpty = () => library.loaded() && scope().length === 0 && pageIdeas().length === 0;

  const setView = (scope: ViewScope, mode: ViewMode) => {
    if (mode === "board") exitSelect();
    libraryPrefs.setViewMode(scope, mode);
  };

  return (
    <div class="lib-page" classList={{ "has-peek": peekStore.scriptId() !== null }}>
      <PageBar />

      <div class="lib-scroll" classList={{ "has-selbar": selectMode() }}>
        <div class="lib" classList={{ "is-board": isBoard() }}>
          <ScriptsHeader
            title={pageTitle()}
            isAll={isAll()}
            isInbox={isInbox()}
            week={week()}
            scopeCount={scope().length}
            folderId={folderId()}
            folderRange={folderRange()}
          />

          <ScriptsTools
            filterRef={(el) => (filterRef = el)}
            filter={filter()}
            onFilterInput={(value) => {
              setFilter(value);
              applyQuery(value);
            }}
            onClearFilter={clearFilter}
            viewScope={viewScope()}
            isBoard={isBoard()}
            onView={setView}
            selectMode={selectMode()}
            selectDisabled={scope().length === 0}
            onToggleSelect={() => (selectMode() ? exitSelect() : setSelectMode(true))}
            onMenu={menuAt}
            onNewFolder={() => setNewFolderFor([])}
          />

          <Switch>
            <Match when={!library.loaded()}>
              <div class="lib-loading" />
            </Match>
            <Match when={libraryEmpty() && isAll() && !needle()}>
              <FirstScriptEmpty onNewScript={newScriptHere} />
              <Show when={showTeaser()}>
                <IdeasTeaser />
              </Show>
            </Match>
            <Match when={nothingFound()}>
              <NoMatchesEmpty query={query().trim()} />
            </Match>
            <Match when={scopeEmpty() && !needle()}>
              <ScopeEmpty isInbox={isInbox()} status={status()} folderName={folderName()} onNewScript={newScriptHere} />
            </Match>
            <Match when={isBoard()}>
              <Board
                columns={data.boardColumns()}
                peekId={peekStore.scriptId()}
                showFolder={folderId() === null}
                onOpen={(s, inverse) => openFromList(s.id, s.title, inverse)}
                onOpenIdea={openIdea}
                onMenu={(s, e, anchor) => openRowMenu(s, e, anchor)}
                onNewScript={newScriptHere}
              />
            </Match>
            <Match when={true}>
              <ScriptList
                selection={sel}
                selectableCount={data.selectableIds().length}
                blocks={data.blocks()}
                contentHits={contentHits()}
                canCollapse={data.canCollapse()}
                collapseKey={data.collapseKey}
                hasMore={data.hasMore()}
                moreCount={Math.min(PAGE_SIZE, sorted().length - limit())}
                onMore={() => setLimit((n) => n + PAGE_SIZE)}
                inboxIdeas={inboxIdeas()}
                ideasClosed={data.ideasClosed()}
                ideasCanCollapse={!needle()}
                peekId={peekStore.scriptId()}
                onNewScript={newScriptHere}
                onToggleSelect={toggleSelect}
                onMenu={openRowMenu}
              />
            </Match>
          </Switch>
        </div>
      </div>

      <Show when={selectMode()}>
        <SelectionBar
          count={selected().size}
          allSelected={sel.allState() === "all"}
          onSelectAll={sel.selectAll}
          onClear={sel.clear}
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
