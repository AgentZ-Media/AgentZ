import { createSignal } from "solid-js";
import { flushAll } from "../lib";
import { getKvStore, type KvStore } from "../platform";
import { createStatePersistence } from "./persistedState";

export interface NavStoreOptions<Route> {
  home: Route;
  key?: string;
  maxHistory?: number;
  encode(route: Route): string;
  /** Product metadata decoding stays with the caller. Check active after awaits. */
  read(kv: KvStore, active: () => boolean): Promise<Route | undefined>;
  onNavigate?(route: Route): void;
  onFlushFailed?(): void;
}

/** Navigation history independent of any product route or state shape. */
export function createNavStore<Route>(options: NavStoreOptions<Route>) {
  const [route, setRoute] = createSignal<Route>(options.home);
  const [history, setHistory] = createSignal<Route[]>([options.home]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  const sameRoute = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);
  type Runtime = {
    active: boolean;
    kv: KvStore;
    queue: Promise<void>;
    persistence: ReturnType<typeof createStatePersistence>;
    stop(): void;
  };
  let runtime: Runtime | undefined;
  const persist = () => runtime?.persistence.schedule(options.encode(route()));
  function defer(apply: () => void): Promise<void> {
    const current = runtime;
    if (!current?.active) return Promise.resolve();
    current.queue = current.queue.then(async () => {
      if (!current.active) return;
      const result = await flushAll(2000);
      if (!current.active) return;
      // Only unsaved content blocks navigation; failed UI state stays queued
      // in its saver and is retried by the next flush.
      if (result.contentFailed.length) { options.onFlushFailed?.(); return; }
      apply();
    }).catch(() => { if (current.active) options.onFlushFailed?.(); });
    return current.queue;
  }
  function step(delta: -1 | 1) {
    const index = historyIndex() + delta;
    if (index < 0 || index >= history().length) return;
    setHistoryIndex(index);
    setRoute(() => history()[index]);
    persist();
  }
  const store = {
    route,
    canBack: () => historyIndex() > 0,
    canForward: () => historyIndex() < history().length - 1,
    persist,
    start(kv = getKvStore()): () => void {
      if (runtime?.active) return runtime.stop;
      const persistence = createStatePersistence(kv, options.key ?? "nav.state", 80);
      const current: Runtime = {
        active: true, kv, queue: Promise.resolve(), persistence,
        stop() {
          if (!current.active) return;
          current.active = false;
          persistence.dispose();
          if (runtime === current) runtime = undefined;
        },
      };
      runtime = current;
      setRoute(() => options.home);
      setHistory([options.home]);
      setHistoryIndex(0);
      return current.stop;
    },
    async load() {
      const current = runtime;
      if (!current) throw new Error("Navigation runtime must start before load.");
      let restored: Route | undefined;
      try { restored = await options.read(current.kv, () => current.active); }
      catch { /* A malformed saved route falls back to the initial route. */ }
      if (!current.active) return;
      const next = restored ?? options.home;
      setRoute(() => next);
      setHistory([next]);
      setHistoryIndex(0);
    },
    go(next: Route): Promise<void> {
      return defer(() => {
        if (sameRoute(next, route())) return;
        const base = history().slice(0, historyIndex() + 1);
        const updated = [...base, next].slice(-(options.maxHistory ?? 50));
        setHistory(updated);
        setHistoryIndex(updated.length - 1);
        setRoute(() => next);
        options.onNavigate?.(next);
        persist();
      });
    },
    back: () => store.canBack() ? defer(() => step(-1)) : runtime?.queue ?? Promise.resolve(),
    forward: () => store.canForward() ? defer(() => step(1)) : runtime?.queue ?? Promise.resolve(),
    reconcile(keep: (route: Route) => boolean) {
      const existing = history();
      if (!existing.every(keep)) {
        const current = route();
        const filtered = existing.filter(keep);
        const safe = filtered.length ? filtered : [options.home];
        setHistory(safe);
        if (!keep(current)) {
          setHistoryIndex(Math.min(historyIndex(), safe.length - 1));
          void defer(() => {
            if (!keep(route())) {
              setHistoryIndex(history().length - 1);
              setRoute(() => history()[history().length - 1]);
            }
            persist();
          });
          return;
        }
        const index = safe.findIndex((entry) => sameRoute(entry, current));
        setHistoryIndex(index >= 0 ? index : safe.length - 1);
      }
      persist();
    },
  };
  return store;
}
