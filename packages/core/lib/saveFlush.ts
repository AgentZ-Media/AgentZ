// Central registry of "pending save flushers" - anything that buffers
// writes (the editor's debounced auto-save, the navigation state, idea
// drafts, inline title edits, etc.) registers a callback here. The
// window-close handler in App.tsx awaits all of them before destroying
// the window, and route changes, export and snapshot restore await them
// first, so the user never loses the last 250 ms of typing to a Cmd+Q,
// a script switch or a stale export.
//
// Each flusher is expected to return a Promise that resolves once the
// buffered write AND every write already in flight is persisted.
// Implementations must be safe to call repeatedly: calling flush twice in
// quick succession or on a nothing-to-do state must resolve cleanly
// without throwing.

type Flusher = () => Promise<void> | void;

const flushers = new Set<Flusher>();

export function registerFlusher(fn: Flusher): () => void {
  flushers.add(fn);
  return () => {
    flushers.delete(fn);
  };
}

export async function flushAll(timeoutMs = 2000): Promise<void> {
  // Every call runs a fresh pass over all flushers. Flushers are
  // serialized internally (lib/serialSave.ts): a second call while the
  // first is still running queues behind it and only writes what changed
  // since, so there are no duplicate parallel writes. Reusing the first
  // call's promise instead (the old singleton) would hand a later caller a
  // pass that started before its edits and miss them.
  const fns = Array.from(flushers);
  if (fns.length === 0) return;
  const tasks = fns.map((fn) => {
    try {
      const r = fn();
      return r instanceof Promise ? r : Promise.resolve();
    } catch {
      return Promise.resolve();
    }
  });
  // Bound the wait so a wedged write never prevents the window from
  // closing or the navigation from happening.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([Promise.allSettled(tasks).then(() => undefined), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
