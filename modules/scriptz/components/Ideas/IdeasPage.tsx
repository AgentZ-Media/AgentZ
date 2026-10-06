import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  on,
  onMount,
  untrack,
} from "solid-js";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { isModKey } from "@agentz/kit/platform";
import { ideasStore } from "../../stores/ideas";
import { navStore } from "../../stores/nav";
import { uiStore } from "../../stores/ui";
import { t } from "../../i18n";
import type { Idea } from "../../lib/types";
import { agentModeAvailable, writeIdeaWithAgent } from "../AgentMode/actions";
import { PageBar } from "../Library/PageBar";
import { ContextMenu, type ContextMenuItem } from "../Common/ContextMenu";
import { PromptDialog } from "../Common/PromptDialog";
import { SelectionBar } from "../Common/SelectionBar";
import { SelectAllLine } from "../Common/SelectCheck";
import { rangeBetween } from "../Common/selection";
import { createListSelection } from "../Common/listSelection";
import { createFolder } from "../Library/actions";
import { groupLabel, inFolder, scopeIdeas } from "./ideaGroups";
import {
  PAGE_SIZE,
  createIdeasLists,
  createIdeasSources,
  groupOpen,
  query,
  rowLimit,
  setGroupOpen,
  setQuery,
  setRowLimit,
  setShowUsed,
  setSort,
  showUsed,
  sort,
} from "./ideasView";
import {
  convertIdea,
  ideaMoveMenu,
  ideaStageMenu,
  moveIdeas as moveIdeasTo,
  removeIdeas,
} from "./ideaActions";
import { createIdeasKeyHandler } from "./ideasKeys";
import { CaptureField, createCapture } from "./parts/CaptureField";
import { IdeaRow } from "./parts/IdeaRow";
import { IdeasEmpty } from "./parts/IdeasEmpty";
import { IdeasKeyHints } from "./parts/IdeasKeyHints";
import { IdeaGroupHeader } from "./parts/IdeaGroupHeader";
import { IdeasToolbar } from "./parts/IdeasToolbar";
import { IdeaEditor, type IdeaEditorHandle } from "./parts/IdeaEditor";
import "./IdeasPage.css";

/** The ideas page (route `{ kind: "ideas", folderId? }`): capture field
 *  (expands for notes + folder), folder chips and a dense time-grouped
 *  list whose rows open in place into an editor (IdeaEditor). */
export function IdeasPage() {
  const ideas = () => ideasStore.ideas() ?? [];
  const { folders, scripts } = createIdeasSources();

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
  const {
    scoped,
    counts,
    visible,
    groups,
    openCount,
    freshCount,
    chipFolders,
    filtering,
    isOpen,
    paging,
    shownItems,
    visibleIds,
    groupById,
    ideaById,
    selectableIds,
  } = createIdeasLists({ ideas, folders, activeFolder, openId, openQuery, now });

  // ---- selection ----
  // Outside the selection mode `selected` is just the primary row (the one
  // that opens in place). The selection mode (button, ⌘A, ⌘/⇧-click) shows
  // checkboxes and closes the open row: clicks toggle rows, `primary` is
  // only the keyboard cursor.
  const sel = createListSelection({ selectableIds: () => selectableIds() });
  const { selectMode, setSelectMode, selected, setSelected } = sel;
  const [primary, setPrimary] = createSignal<string | null>(null);
  const [anchor, setAnchor] = createSignal<string | null>(null);
  const [wanted, setWanted] = createSignal<string | null>(null);
  /** Open the wanted idea's row once it is selected. */
  const [wantedOpen, setWantedOpen] = createSignal(false);
  let editor: IdeaEditorHandle | null = null;
  let listRef: HTMLDivElement | undefined;
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

  function exitSelectMode() {
    setSelectMode(false);
    selectOnly(primary() ?? visibleIds()[0] ?? null);
  }

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
        const openIt = wantedOpen();
        batch(() => {
          setWanted(null);
          setWantedOpen(false);
          setSelectMode(false);
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
    if (selectMode()) {
      // Checked rows may sit beyond the loaded page; only drop the ones
      // that left the view (deleted, converted, filtered out).
      const live = new Set(visible().map((i) => i.id));
      sel.retain((id) => live.has(id));
      if (!p || !ids.includes(p)) setPrimary(ids[0] ?? null);
      return;
    }
    if (p && ids.includes(p)) {
      // Drop selected rows that are no longer visible.
      sel.retain((id) => ids.includes(id));
      return;
    }
    selectOnly(ids[0] ?? null);
  });

  // Only the primary row of a single selection stays open: moving the
  // selection, entering the selection mode, filtering it away or deleting
  // it closes it (the editor writes its draft on teardown).
  createEffect(() => {
    const id = openId();
    if (!id) return;
    if (selectMode() || primary() !== id || selected().size > 1 || !visibleIds().includes(id)) setOpenId(null);
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
    const from = anchor() ?? primary();
    const range = e.shiftKey && from ? rangeBetween(visibleIds(), from, id) : null;
    if (range) {
      // Shift-click: adds the range (starts the selection mode from the
      // plain list).
      if (selectMode()) sel.add(range);
      else sel.enter(range);
      setPrimary(id);
      setAnchor(id);
      return;
    }
    if (selectMode() || isModKey(e)) {
      // ⌘-click on the plain list starts the selection with the current row.
      if (!selectMode()) sel.enter(primary() && primary() !== id ? [primary()!] : []);
      sel.toggle([id]);
      setPrimary(id);
      setAnchor(id);
      return;
    }
    openRow(id);
  }

  function toggleRow(id: string) {
    sel.toggle([id]);
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
    // Selection mode: the arrows move the cursor row, space checks it.
    const id = ids[next];
    setPrimary(id);
    setAnchor(id);
    queueMicrotask(() => document.getElementById(`idea-row-${id}`)?.scrollIntoView({ block: "nearest" }));
  }

  // ---- capture field ----
  const capture = createCapture({
    ideas,
    activeFolder,
    convert: convertIdea,
    onCreated: (idea) => {
      setQuery("");
      setWantedOpen(false);
      setWanted(idea.id);
    },
  });

  // ---- actions ----
  const moveIdeas = (list: Idea[], folderId: string | null, name = folderName(folderId)) =>
    moveIdeasTo(list, folderId, name);

  const selectedIdeas = () => {
    const ids = selected();
    return visible().filter((i) => ids.has(i.id));
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
  const onKey = createIdeasKeyHandler({
    menuOpen: () => !!menu(),
    selectMode,
    selectedCount: () => selected().size,
    selectableCount: () => selectableIds().length,
    primary,
    primaryIdea,
    openId,
    selectedIdeas,
    capture: capture.submit,
    convert: convertIdea,
    removeIdeas,
    selectAll: sel.selectAll,
    toggleRow,
    focusFilter: () => filterRef?.focus(),
    move,
    openRow,
    focusEditor,
    closeRow,
    exitSelectMode,
  });
  onMount(() => {
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <div class="ideas-page">
      <PageBar />

      <div class="ideas">
        <div class="ideas-main">
          <div class="i-head">
            <h1>{t("ideasPage.title")}</h1>
            <span>{t("ideasPage.head.counts", { open: openCount(), fresh: freshCount() })}</span>
          </div>

          <CaptureField capture={capture} folders={folders() ?? []} onReveal={revealIdea} />

          <IdeasToolbar
            folders={folders() ?? []}
            chipFolders={chipFolders()}
            total={scoped().length}
            byFolder={counts().byFolder}
            inbox={counts().inbox}
            activeFolder={activeFolder()}
            onFolder={setFolder}
            filterRef={(el) => (filterRef = el)}
            query={query()}
            onQuery={setQuery}
            onFilterLeave={(selectFirst) => {
              listRef?.focus();
              if (selectFirst) move(0);
            }}
            sort={sort()}
            onSort={setSort}
            showUsed={showUsed()}
            onShowUsed={setShowUsed}
            selectMode={selectMode()}
            selectDisabled={!selectMode() && visible().length === 0}
            onToggleSelect={() => (selectMode() ? exitSelectMode() : sel.enter())}
          />

          <Show when={selectMode() && selectableIds().length > 0}>
            <SelectAllLine state={sel.allState()} count={selectableIds().length} onToggle={sel.toggleAll} />
          </Show>

          <div class="ilist-scroll" classList={{ "has-selbar": selectMode() }}>
            <Show
              when={groups().length > 0}
              fallback={
                <IdeasEmpty
                  none={ideas().length === 0}
                  query={query().trim()}
                  filtering={filtering()}
                  activeFolder={activeFolder()}
                />
              }
            >
              <div
                ref={listRef}
                class="ilist"
                classList={{ "is-selecting": selectMode() }}
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
                          <IdeaGroupHeader
                            selection={sel}
                            group={g()}
                            label={groupLabel(g(), new Date(now()))}
                            open={isOpen(g())}
                            onToggle={() => setGroupOpen({ ...groupOpen(), [gid]: !isOpen(g()) })}
                          />
                          <Show when={isOpen(g())}>
                            <For each={shownItems(g()).map((i) => i.id)}>
                              {(id) => (
                                <Show when={ideaById().get(id)}>
                                  {(idea) => (
                                    <Show
                                      when={openId() === id}
                                      fallback={
                                        <IdeaRow
                                          idea={idea()}
                                          selected={selected().has(idea().id)}
                                          primary={primary() === idea().id}
                                          selectMode={selectMode()}
                                          scripts={scripts()}
                                          folderName={folderName}
                                          now={now()}
                                          onClick={(e) => onRowClick(e, idea().id)}
                                        />
                                      }
                                    >
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
                                          onConvert={(i) => void convertIdea(i)}
                                          onWriteWithAgent={agentModeAvailable() ? (i) => void writeIdeaWithAgent(i) : undefined}
                                          onOpenSession={(chatId) => void navStore.openAgent(chatId)}
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

          <IdeasKeyHints hidden={selectMode()} />

          <Show when={selectMode()}>
            <SelectionBar
              count={selected().size}
              allSelected={sel.allState() === "all"}
              onSelectAll={sel.selectAll}
              onClear={sel.clear}
              onExit={exitSelectMode}
              onMove={(el) =>
                menuAbove(el, ideaMoveMenu(selectedIdeas(), folders() ?? [], (l, f, n) => void moveIdeas(l, f, n), setNewFolderFor))
              }
              onStage={(el) => menuAbove(el, ideaStageMenu(selectedIdeas()), 200)}
              stageLabel={t("ideasPage.selection.convert")}
              stageDisabled={selectedIdeas().every((i) => !!i.used_at)}
              onTrash={() => void removeIdeas(selectedIdeas())}
              trashLabel={t("common.delete")}
            />
          </Show>
        </div>
      </div>

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
