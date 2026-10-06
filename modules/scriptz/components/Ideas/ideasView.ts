// View state and derived lists of the ideas page: the session-level filter,
// sort and paging signals, the folder and script resources, and the memos
// built on them (scope, folder counts, time groups, the rendered page).
// `createIdeasSources` and `createIdeasLists` are called once from
// IdeasPage, so their resources, memos and effect live in the page's owner.

import { createEffect, createMemo, createResource, createSignal, on, type Accessor } from "solid-js";
import { localeCompare } from "@agentz/kit/i18n";
import { api } from "../../lib/api";
import { foldersBus } from "../../lib/foldersBus";
import { scriptsBus } from "../../lib/scriptsBus";
import type { Folder, Idea, ScriptSummary } from "../../lib/types";
import {
  countNewThisWeek,
  folderCounts,
  groupIdeas,
  inFolder,
  scopeIdeas,
  sortIdeas,
  type IdeaGroup,
  type IdeaSort,
} from "./ideaGroups";

/** Rows rendered per page across all open groups; "Weitere laden" adds
 *  another page. Keeps the DOM small for very large idea collections. */
export const PAGE_SIZE = 50;

// Session-level view state: survives leaving and re-entering the page.
export const [sort, setSort] = createSignal<IdeaSort>("newest");
export const [showUsed, setShowUsed] = createSignal(false);
export const [query, setQuery] = createSignal("");
/** Explicit open/closed state per group id; default: "older" closed. */
export const [groupOpen, setGroupOpen] = createSignal<Record<string, boolean>>({});
/** How many rows (across open groups, in display order) are rendered. */
export const [rowLimit, setRowLimit] = createSignal(PAGE_SIZE);

/** Every folder (chips, pickers) and the live scripts by id (links of
 *  converted ideas), refetched when their bus bumps. */
export function createIdeasSources() {
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
  return { folders, scripts };
}

export interface IdeasListsDeps {
  ideas: Accessor<Idea[]>;
  folders: Accessor<Folder[] | undefined>;
  activeFolder: Accessor<string | null>;
  /** The row shown expanded as an editor. */
  openId: Accessor<string | null>;
  /** The text filter when the row was opened. */
  openQuery: Accessor<string>;
  now: Accessor<number>;
}

export function createIdeasLists(deps: IdeasListsDeps) {
  const { ideas, folders, activeFolder, openId, openQuery, now } = deps;

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

  /** What "select all" covers: every idea of the current view (beyond the
   *  loaded page too), except groups that are collapsed. */
  const selectableIds = createMemo(() => {
    const ids: string[] = [];
    for (const g of groups()) if (isOpen(g)) for (const i of g.items) ids.push(i.id);
    return ids;
  });

  return {
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
  };
}
