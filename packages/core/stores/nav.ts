import { createSignal } from "solid-js";
import { api } from "../lib/api";
import { flushAll, registerFlusher } from "../lib/saveFlush";
import type { ScriptStatus } from "../lib/types";

/**
 * Navigation store for the Werkbank shell. Replaces the old tab store.
 *
 * - `route()` is the single source of truth for what the main column shows.
 * - Browser-like history (⌘[ / ⌘]) instead of tabs.
 * - `recent()` feeds the "Zuletzt" section of the sidebar and the empty
 *   state of the command palette.
 *
 * Every route change first drains pending saves (editor auto-save etc.)
 * via `flushAll`, then applies the route. This keeps the "editor is torn
 * down while an async persist is still running" race out, exactly like
 * the old tab store did. Route changes are serialized in one queue and
 * every step reads the history state when it APPLIES (not when it was
 * requested), so rapid ⌘[ / ⌘] presses during a slow flush can never
 * step past either end of the history.
 */

export type Route =
  | {
      kind: "scripts";
      /** Pipeline filter. Undefined/null = all scripts. */
      status?: ScriptStatus | null;
      /** Folder filter. Undefined/null = every folder; INBOX_FOLDER_ID =
       *  scripts without a folder (see lib/folders.ts). */
      folderId?: string | null;
    }
  | { kind: "ideas"; folderId?: string | null }
  | { kind: "script"; scriptId: string }
  | { kind: "trash" };

export interface RecentEntry {
  scriptId: string;
  title: string;
  openedAt: number;
}

const STATE_KEY = "nav.state";
const LEGACY_TABS_KEY = "open_tabs";
const MAX_RECENT = 8;
const MAX_HISTORY = 50;

const HOME: Route = { kind: "scripts" };

const [route, setRoute] = createSignal<Route>(HOME);
const [history, setHistory] = createSignal<Route[]>([HOME]);
const [historyIndex, setHistoryIndex] = createSignal(0);
const [recent, setRecent] = createSignal<RecentEntry[]>([]);

function sameRoute(a: Route, b: Route): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let navQueue: Promise<void> = Promise.resolve();

function deferRouteChange(apply: () => void): Promise<void> {
  navQueue = navQueue
    .then(() => flushAll(2000))
    .catch(() => {})
    .then(() => apply())
    .catch((err) => console.warn("[scriptz] route change failed", err));
  return navQueue;
}

/** Steps through the history by `delta` if that's still possible at the
 *  moment the step applies. */
function stepHistory(delta: -1 | 1) {
  const i = historyIndex() + delta;
  const hist = history();
  if (i < 0 || i >= hist.length) return;
  setHistoryIndex(i);
  setRoute(hist[i]);
  persist();
}

function touchRecent(scriptId: string, title?: string) {
  const prev = recent();
  const existing = prev.find((r) => r.scriptId === scriptId);
  const entry: RecentEntry = {
    scriptId,
    title: title ?? existing?.title ?? "",
    openedAt: Date.now(),
  };
  const next = [entry, ...prev.filter((r) => r.scriptId !== scriptId)].slice(0, MAX_RECENT);
  setRecent(next);
}

function pushRoute(next: Route) {
  if (sameRoute(next, route())) return;
  const base = history().slice(0, historyIndex() + 1);
  const trimmed = [...base, next].slice(-MAX_HISTORY);
  setHistory(trimmed);
  setHistoryIndex(trimmed.length - 1);
  setRoute(next);
  if (next.kind === "script") touchRecent(next.scriptId);
  persist();
}

export const navStore = {
  route,
  recent,
  canBack: () => historyIndex() > 0,
  canForward: () => historyIndex() < history().length - 1,

  /** Id of the script in the main column, or null. */
  activeScriptId(): string | null {
    const r = route();
    return r.kind === "script" ? r.scriptId : null;
  },
  isScript: () => route().kind === "script",
  isIdeas: () => route().kind === "ideas",
  isScripts: () => route().kind === "scripts",
  isTrash: () => route().kind === "trash",

  /** Navigate to any route (pushes onto the history). */
  go(next: Route): Promise<void> {
    return deferRouteChange(() => pushRoute(next));
  },
  /** Open a script. `title` keeps the "Zuletzt" list readable before the
   *  script itself has loaded. */
  openScript(scriptId: string, title?: string): Promise<void> {
    if (title !== undefined) touchRecent(scriptId, title);
    return deferRouteChange(() => pushRoute({ kind: "script", scriptId }));
  },
  openScripts(filter: { status?: ScriptStatus | null; folderId?: string | null } = {}): Promise<void> {
    return navStore.go({ kind: "scripts", ...filter });
  },
  openIdeas(folderId?: string | null): Promise<void> {
    return navStore.go({ kind: "ideas", folderId: folderId ?? null });
  },
  back(): Promise<void> {
    if (!navStore.canBack()) return navQueue;
    return deferRouteChange(() => stepHistory(-1));
  },
  forward(): Promise<void> {
    if (!navStore.canForward()) return navQueue;
    return deferRouteChange(() => stepHistory(1));
  },

  /** Keep the "Zuletzt" title in sync after a rename. */
  setScriptTitle(scriptId: string, title: string) {
    const prev = recent();
    if (!prev.some((r) => r.scriptId === scriptId && r.title !== title)) return;
    setRecent(prev.map((r) => (r.scriptId === scriptId ? { ...r, title } : r)));
    persist();
  },

  /** Drop everything that points at scripts that no longer exist (purged
   *  or moved to the trash). The active route falls back to the library. */
  reconcile(liveScriptIds: Set<string>) {
    const keep = (r: Route) => r.kind !== "script" || liveScriptIds.has(r.scriptId);
    const prevRecent = recent();
    const nextRecent = prevRecent.filter((r) => liveScriptIds.has(r.scriptId));
    if (nextRecent.length !== prevRecent.length) setRecent(nextRecent);

    const hist = history();
    if (!hist.every(keep)) {
      const current = route();
      const filtered = hist.filter(keep);
      const safe = filtered.length > 0 ? filtered : [HOME];
      setHistory(safe);
      if (!keep(current)) {
        // Keep the index valid for the new history right away; the route
        // itself switches after the flush. The deferred step re-reads the
        // state, since other navigation may have applied in between.
        setHistoryIndex(Math.min(historyIndex(), safe.length - 1));
        void deferRouteChange(() => {
          const r = route();
          if (r.kind === "script" && !liveScriptIds.has(r.scriptId)) {
            const hist = history();
            setHistoryIndex(hist.length - 1);
            setRoute(hist[hist.length - 1]);
          }
          persist();
        });
        return;
      }
      const idx = safe.findIndex((r) => sameRoute(r, current));
      setHistoryIndex(idx >= 0 ? idx : safe.length - 1);
    }
    persist();
  },

  async load() {
    try {
      const raw = await api.getAppState(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { route?: Route; recent?: RecentEntry[] };
        const restoredRecent = Array.isArray(parsed.recent) ? parsed.recent.slice(0, MAX_RECENT) : [];
        setRecent(restoredRecent);
        const r = parsed.route && typeof parsed.route === "object" ? parsed.route : HOME;
        setRoute(r);
        setHistory([r]);
        setHistoryIndex(0);
        return;
      }
      // Migration from the tab store: open tabs become "Zuletzt".
      const legacy = await api.getAppState(LEGACY_TABS_KEY);
      if (legacy) {
        const parsed = JSON.parse(legacy) as {
          tabs?: Array<{ scriptId?: string; scriptTitle?: string }>;
        };
        const now = Date.now();
        const fromTabs: RecentEntry[] = (parsed.tabs ?? [])
          .filter((t): t is { scriptId: string; scriptTitle?: string } => !!t?.scriptId)
          .reverse()
          .slice(0, MAX_RECENT)
          .map((t, i) => ({ scriptId: t.scriptId, title: t.scriptTitle ?? "", openedAt: now - i }));
        setRecent(fromTabs);
        persist();
      }
    } catch {
      setRoute(HOME);
    }
  },
};

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistInflight: Promise<void> | null = null;

function writeNow(): Promise<void> {
  // Chained behind the previous write so two snapshots of the nav state
  // can never land out of order.
  const prev = persistInflight ?? Promise.resolve();
  const p: Promise<void> = prev.then(() => {
    const payload = JSON.stringify({ route: route(), recent: recent() });
    return api.setAppState(STATE_KEY, payload).catch(() => {});
  });
  const tracked: Promise<void> = p.finally(() => {
    if (persistInflight === tracked) persistInflight = null;
  });
  persistInflight = tracked;
  return tracked;
}

function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void writeNow();
  }, 80);
}

registerFlusher(async () => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    await writeNow();
    return;
  }
  if (persistInflight) await persistInflight;
});
