import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup, onMount } from "solid-js";
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
import { FolderMenu } from "./parts/FolderMenu";
import { SortMenu } from "./parts/SortMenu";
import { IdeaDetail, type IdeaDetailHandle } from "./parts/IdeaDetail";
import "./IdeasPage.css";

/** Rows a month group shows before "N weitere" (the week group shows all). */
const GROUP_CAP = 8;

// Session-level view state: survives leaving and re-entering the page.
const [sort, setSort] = createSignal<IdeaSort>("newest");
const [showUsed, setShowUsed] = createSignal(false);
const [query, setQuery] = createSignal("");
/** Explicit open/closed state per group id; default: "older" closed. */
const [groupOpen, setGroupOpen] = createSignal<Record<string, boolean>>({});
/** Groups whose "N weitere" row was expanded. */
const [groupFull, setGroupFull] = createSignal<Record<string, boolean>>({});

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
  const shownItems = (g: IdeaGroup<Idea>) => {
    if (filtering() || g.kind !== "month" || groupFull()[g.id]) return g.items;
    return g.items.slice(0, GROUP_CAP);
  };
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

  // Keep a valid selection: follow a freshly created idea once it shows
  // up, otherwise fall back to the first visible row.
  createEffect(() => {
    const ids = visibleIds();
    const want = wanted();
    if (want) {
      if (ids.includes(want)) {
        setWanted(null);
        selectOnly(want, true);
        return;
      }
      if (ideas().some((i) => i.id === want)) setWanted(null);
      else return; // not loaded yet
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
    selectOnly(id);
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

  function openSimilarIdea(id: string) {
    const idea = ideas().find((i) => i.id === id);
    if (!idea) return;
    setQuery("");
    if (idea.used_at && !showUsed()) setShowUsed(true);
    const fid = activeFolder();
    if (fid !== null && (fid === INBOX_FOLDER_ID ? !!idea.folder_id : idea.folder_id !== fid)) setFolder(null);
    setWanted(id);
  }

  // ---- keyboard ----
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || uiStore.anyDialogOpen()) return;
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
      const list = selected().size > 1 ? selectedIdeas() : primaryIdea() ? [primaryIdea()!] : [];
      if (list.length > 0) {
        e.preventDefault();
        void removeIdeas(list);
      }
      return;
    }
    if (e.key === "Escape" && selected().size > 1) {
      e.preventDefault();
      selectOnly(primary());
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
                aria-activedescendant={primary() ? `idea-row-${primary()}` : undefined}
                tabindex="0"
              >
                <For each={groups()}>
                  {(g) => (
                    <>
                      <button
                        type="button"
                        class="igrp-h"
                        classList={{ closed: !isOpen(g) }}
                        aria-expanded={isOpen(g)}
                        onClick={() => setGroupOpen({ ...groupOpen(), [g.id]: !isOpen(g) })}
                      >
                        <Icon name={isOpen(g) ? "down" : "right"} size={11} />
                        {groupLabel(g, new Date(now()))} <em>{g.items.length}</em>
                      </button>
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
                                selectOnly(idea.id);
                                queueMicrotask(() => detail?.focusNotes());
                              }}
                            >
                              <Show when={idea.used_at} fallback={<StageGlyph stage="idea" />}>
                                <Icon name="check" size={14} />
                              </Show>
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
                        <Show when={shownItems(g).length < g.items.length}>
                          <button
                            type="button"
                            class="irow more"
                            onClick={() => setGroupFull({ ...groupFull(), [g.id]: true })}
                          >
                            <span />
                            <span>
                              {t("ideasPage.group.more", {
                                count: g.items.length - shownItems(g).length,
                                group: groupLabel(g, new Date(now())),
                              })}
                            </span>
                          </button>
                        </Show>
                      </Show>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="i-keys">
            {keyHint("↑ ↓", t("ideasPage.keys.select"))} ·{" "}
            {keyHint("⏎", t("ideasPage.keys.edit"))} ·{" "}
            {keyHint(K("Mod+Enter"), t("ideasPage.keys.convert"))} ·{" "}
            {keyHint("⌫", t("ideasPage.keys.delete"))} ·{" "}
            <kbd>{K("Shift")}</kbd>
            {t("ideasPage.keys.multi")}
          </div>
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
                  onSelectIdea={openSimilarIdea}
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
          selectOnly(primary());
          ideasStore.refresh();
        }}
      />
    </div>
  );
}

export default IdeasPage;
