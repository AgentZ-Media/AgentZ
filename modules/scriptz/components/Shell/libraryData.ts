// Shared, reactive library data for the Werkbank shell.
//
// The sidebar (counts), the scripts page (groups, week line), the command
// palette (title matches) and the shell itself (nav reconcile) all need the
// same two lists: every live script and every folder. They are loaded once
// here, refetched on `scriptsBus` / `foldersBus` bumps, and shared - instead
// of each surface issuing its own `listScripts` roundtrip.
//
// The shell starts and disposes this cache explicitly after boot. No
// resources exist before adapters, settings and legacy migration are ready.

import { createMemo, createResource, createRoot, createSignal } from "solid-js";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { foldersBus } from "../../lib/foldersBus";
import { folderColor } from "../Ideas/folderColor";
import { resolveLengthRange, type LengthRange } from "../../lib/lengthGoal";
import { runtimeSeconds } from "../../lib/runtime";
import { INBOX_FOLDER_ID } from "../../lib/folders";
import { ideasStore } from "../../stores/ideas";
import { settingsStore } from "../../stores/settings";
import { isFinalStage } from "../../lib/stages";
import type { Folder, Idea, ScriptStatus, ScriptSummary } from "../../lib/types";

const [ready, setReady] = createSignal(false);
// False while the last script fetch failed. The nav reconcile must never run
// against a list that is empty only because storage threw.
const [scriptsOk, setScriptsOk] = createSignal(false);
// Sticky: true after the first successful load. UI empty states key off
// this so they don't flicker while a refetch is in flight.
const [loadedOnce, setLoadedOnce] = createSignal(false);

function createLibraryData(isActive: () => boolean) {
  const [scripts] = createResource<ScriptSummary[], { v: number }>(
    () => (ready() ? { v: scriptsBus.version() } : false),
    async (_src, info): Promise<ScriptSummary[]> => {
      try {
        const list = await api.listScripts({});
        if (!isActive()) return [];
        setScriptsOk(true);
        setLoadedOnce(true);
        return list;
      } catch (err) {
        if (!isActive()) return [];
        console.warn("[scriptz] library scripts load failed", err);
        setScriptsOk(false);
        return info.value ?? [];
      }
    },
    { initialValue: [] },
  );

  const [folders] = createResource<Folder[], { f: number; s: number }>(
    () => (ready() ? { f: foldersBus.version(), s: scriptsBus.version() } : false),
    async (_src, info): Promise<Folder[]> => {
      try {
        const list = await api.listFolders();
        return isActive() ? list : [];
      } catch (err) {
        if (!isActive()) return [];
        console.warn("[scriptz] library folders load failed", err);
        return info.value ?? [];
      }
    },
    { initialValue: [] },
  );

  const byId = createMemo(() => {
    const m = new Map<string, ScriptSummary>();
    for (const s of scripts() ?? []) m.set(s.id, s);
    return m;
  });

  // Read through a memo: readers never hit the resource itself, so a refetch
  // (every autosave bumps scriptsBus) cannot suspend the screen they sit in.
  const folderList = createMemo<Folder[]>(() => folders() ?? []);

  const folderMap = createMemo(() => {
    const m = new Map<string, Folder>();
    for (const f of folders() ?? []) m.set(f.id, f);
    return m;
  });

  const openIdeas = createMemo<Idea[]>(() =>
    (ideasStore.ideas() ?? []).filter((i) => !i.used_at),
  );

  /** Scripts before the last stage: the script half of the inbox. */
  const inProgress = createMemo<ScriptSummary[]>(() =>
    (scripts() ?? []).filter((s) => !isFinalStage(s.status)),
  );

  /** Live scripts per stage id. */
  const statusCounts = createMemo(() => {
    const counts = new Map<ScriptStatus, number>();
    for (const s of scripts() ?? []) counts.set(s.status, (counts.get(s.status) ?? 0) + 1);
    return counts;
  });

  /** Live scripts + open ideas per folder id. */
  const folderCounts = createMemo(() => {
    const m = new Map<string, number>();
    for (const s of scripts() ?? []) {
      if (s.folder_id) m.set(s.folder_id, (m.get(s.folder_id) ?? 0) + 1);
    }
    for (const i of openIdeas()) {
      if (i.folder_id) m.set(i.folder_id, (m.get(i.folder_id) ?? 0) + 1);
    }
    return m;
  });

  /** First non-empty line of the notes of the idea a script came from. */
  const ideaLineByScript = createMemo(() => {
    const m = new Map<string, string>();
    for (const i of ideasStore.ideas() ?? []) {
      if (!i.script_id) continue;
      const line = (i.notes ?? "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
      if (line) m.set(i.script_id, line);
    }
    return m;
  });

  return {
    scripts,
    folders,
    folderList,
    byId,
    folderMap,
    openIdeas,
    inProgress,
    statusCounts,
    folderCounts,
    ideaLineByScript,
  };
}

const [data, setData] = createSignal<ReturnType<typeof createLibraryData>>();
let stopRuntime: (() => void) | undefined;

export const library = {
  /** Every live (non-archived) script, newest edit first. */
  scripts: (): ScriptSummary[] => data()?.scripts() ?? [],
  /** Fresh and trustworthy right now: loaded, not refetching, last fetch
   *  succeeded. Gate for destructive syncs (nav reconcile). */
  scriptsReady: (): boolean =>
    ready() && scriptsOk() && data()?.scripts.state === "ready",
  /** The list has been loaded at least once (for empty states). */
  loaded: loadedOnce,
  script: (id: string | null | undefined): ScriptSummary | undefined =>
    id ? data()?.byId().get(id) : undefined,
  folders: (): Folder[] => data()?.folders() ?? [],
  /** Like `folders()`, but never triggers a Suspense boundary while the list
   *  refetches. Use inside the script screen (agent panel): a suspended
   *  screen is detached and loses every scroll position. */
  folderList: (): Folder[] => data()?.folderList() ?? [],
  folder: (id: string | null | undefined): Folder | undefined =>
    id && id !== INBOX_FOLDER_ID ? data()?.folderMap().get(id) : undefined,
  openIdeas: () => data()?.openIdeas() ?? [],
  /** Live scripts that have not reached the last pipeline stage. */
  inProgress: (): ScriptSummary[] => data()?.inProgress() ?? [],
  /** Inbox size: open ideas plus scripts in progress (0 hides the inbox). */
  inboxCount: (): number => (data()?.openIdeas().length ?? 0) + (data()?.inProgress().length ?? 0),
  statusCounts: () => data()?.statusCounts() ?? new Map<ScriptStatus, number>(),
  folderCounts: () => data()?.folderCounts() ?? new Map<string, number>(),
  ideaLine: (scriptId: string): string | undefined => data()?.ideaLineByScript().get(scriptId),
};

/** Start only after boot; the returned disposer owns all shared resources. */
export function startLibraryData(): () => void {
  if (stopRuntime) return stopRuntime;
  let active = true;
  setReady(true);
  const disposeRoot = createRoot((dispose) => {
    setData(createLibraryData(() => active));
    return dispose;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    disposeRoot();
    setReady(false);
    setScriptsOk(false);
    setLoadedOnce(false);
    setData(undefined);
    stopRuntime = undefined;
  };
  stopRuntime = stop;
  return stop;
}

/** Stable folder dot colour, shared with the ideas page and the settings
 *  (one implementation, so a folder looks the same everywhere). */
export { folderColor };

/** Global default range from the settings. */
export function defaultLengthRange(): LengthRange {
  return {
    minSec: settingsStore.lengthMinDefaultSec(),
    maxSec: settingsStore.lengthMaxDefaultSec(),
  };
}

/** Effective target range for a script (its folder's, else the default). */
export function lengthRangeFor(s: ScriptSummary): LengthRange | null {
  return resolveLengthRange(library.folder(s.folder_id) ?? null, defaultLengthRange());
}

/** Estimated runtime in whole seconds, or null when the script was never
 *  measured or is empty (the list then leaves the cell blank). */
export function runtimeSecFor(s: ScriptSummary): number | null {
  if (s.dialog_word_count < 0 || s.direction_block_count < 0) return null;
  if (s.dialog_word_count === 0 && s.direction_block_count === 0) return null;
  return runtimeSeconds(
    { dialogWords: s.dialog_word_count, directionBlocks: s.direction_block_count },
    settingsStore.dialogWpm(),
  );
}

/** Monday 00:00 (local time) of the ISO week containing `now`. */
export function isoWeekStart(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
