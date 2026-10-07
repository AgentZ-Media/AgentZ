// Derived lists of the scripts page: scope, filter matches, full-text hits,
// board columns, groups and the render blocks (groups, folded groups, the
// ideas teaser). Called once from ScriptsPage, so every memo and effect
// lives in the page's owner.

import { createEffect, createMemo, createSignal, on, type Accessor, type JSX } from "solid-js";
import type { Idea, ScriptStatus, ScriptSummary, SearchHit } from "../../lib/types";
import { isFinalStage, scriptStages, stageIndex, stageLabel } from "../../lib/stages";
import { api } from "../../lib/api";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { localeCompare } from "@agentz/kit/i18n";
import { t } from "../../i18n";
import { Icon } from "@agentz/kit/ui";
import { StageGlyph } from "../Common/StageGlyph";
import { folderColor } from "../Common/folderColor";
import { countByFolder } from "../Common/FolderChips";
import { safeSnippet } from "../Palette/snippet";
import { library } from "../Shell/libraryData";
import type { BoardColumn } from "./Board";
import { libraryPrefs, type Grouping, type SortKey } from "./prefs";

export interface Group {
  key: string;
  label: string;
  glyph: () => JSX.Element;
  status?: ScriptStatus;
  /** All matching scripts of the group (counts, material sum). */
  all: ScriptSummary[];
  /** The rows currently rendered (pagination). */
  items: ScriptSummary[];
}

export type Block =
  | { kind: "group"; group: Group }
  | { kind: "closed"; groups: Group[] }
  | { kind: "teaser" };

/** A content match the title filter didn't catch. */
export interface ContentHit {
  script: ScriptSummary;
  snippet: string;
}

export interface ScriptsDataDeps {
  isInbox: () => boolean;
  isAll: () => boolean;
  status: () => ScriptStatus | null;
  folderId: () => string | null;
  /** The debounced filter text. */
  query: Accessor<string>;
  /** Trimmed, lower-cased `query`. */
  needle: () => string;
  /** Rows rendered (pagination). */
  limit: Accessor<number>;
}

function sortScripts(list: ScriptSummary[], key: SortKey): ScriptSummary[] {
  const out = [...list];
  if (key === "title") out.sort((a, b) => localeCompare(a.title, b.title));
  else if (key === "created") out.sort((a, b) => b.created_at - a.created_at);
  else out.sort((a, b) => b.updated_at - a.updated_at);
  return out;
}

export function createScriptsData(deps: ScriptsDataDeps) {
  const { isInbox, isAll, status, folderId, query, needle, limit } = deps;

  /** The page before its folder filter: the inbox, one stage or all. */
  const pageScope = createMemo(() => {
    if (isInbox()) return library.inProgress();
    const st = status();
    return st ? library.scripts().filter((s) => s.status === st) : library.scripts();
  });
  const inFolder = (item: { folder_id: string | null }) => {
    const fid = folderId();
    if (fid === INBOX_FOLDER_ID) return item.folder_id === null;
    return fid === null || item.folder_id === fid;
  };

  const scope = createMemo(() => (folderId() === null ? pageScope() : pageScope().filter(inFolder)));

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

  /** Open ideas of this page in its folder filter (a stage has none). */
  const folderIdeas = createMemo<Idea[]>(() => (status() !== null ? [] : library.openIdeas().filter(inFolder)));
  /** `folderIdeas`, filtered like the rows. Ideas have no edit time, so
   *  "updated" and "created" both list the newest first. */
  const scopeIdeas = createMemo<Idea[]>(() => {
    const n = needle();
    const list = folderIdeas().filter(
      (i) => !n || i.title.toLowerCase().includes(n) || (i.notes ?? "").toLowerCase().includes(n),
    );
    return libraryPrefs.sort() === "title"
      ? list.sort((a, b) => localeCompare(a.title, b.title))
      : list.sort((a, b) => b.created_at - a.created_at);
  });
  /** The inbox list shows its ideas below the stage groups. */
  const inboxIdeas = () => (isInbox() ? scopeIdeas() : []);

  /** Folder chips: what the page lists per folder, before the folder and
   *  text filters (the inbox counts its open ideas too). */
  const folderChips = createMemo(() =>
    countByFolder(isInbox() ? [...pageScope(), ...library.openIdeas()] : pageScope()),
  );

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
    const out: ContentHit[] = [];
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

  return {
    scope,
    folderIdeas,
    folderChips,
    matches,
    sorted,
    scopeIdeas,
    inboxIdeas,
    boardColumns,
    hasMore,
    contentHits,
    canCollapse,
    collapseKey,
    ideasClosed,
    showTeaser,
    blocks,
    renderedIds,
    selectableIds,
  };
}
