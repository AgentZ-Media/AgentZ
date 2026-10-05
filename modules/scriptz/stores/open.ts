import { createSignal } from "solid-js";
import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { createStatePersistence } from "@agentz/kit/stores";

/**
 * The sidebar's "Open" list: the scripts the writer is working on, in the
 * order they were opened, newest first. Every script shown in the full
 * script view joins it and stays until it is closed by hand - or, with the
 * setting on, until it reaches the last stage (see `syncStatuses`).
 *
 * Persisted as `{"ids": [...]}` under its own app_state key. Without a
 * stored list the first load seeds it from the recently opened scripts, so
 * an update doesn't start with an empty sidebar.
 */

const OPEN_KEY = "nav.open";
const MAX_OPEN = 50;
const SEED_COUNT = 5;
/** How long an automatically closed script comes back when its stage
 *  change is undone (the undo toast shows for 5 s). */
const REOPEN_WINDOW_MS = 15_000;

const [ids, setIds] = createSignal<string[]>([]);

/** Last stage seen per live script; null until the first sync. */
let lastStatus: Map<string, string> | null = null;
/** Finished while on screen: closes as soon as the writer switches away. */
const pendingClose = new Set<string>();
/** Closed by the finish rule: id -> where it was and when. */
const autoClosed = new Map<string, { index: number; at: number }>();

type Runtime = {
  active: boolean;
  kv: KvStore;
  writer: ReturnType<typeof createStatePersistence>;
  stop(): void;
};
let runtime: Runtime | undefined;

function resetState() {
  setIds([]);
  lastStatus = null;
  pendingClose.clear();
  autoClosed.clear();
}

export function startOpenStore(kv = getKvStore()): () => void {
  if (runtime?.active) return runtime.stop;
  const writer = createStatePersistence(kv, OPEN_KEY);
  resetState();
  const current: Runtime = {
    active: true,
    kv,
    writer,
    stop() {
      if (!current.active) return;
      current.active = false;
      writer.dispose();
      if (runtime === current) runtime = undefined;
    },
  };
  runtime = current;
  return current.stop;
}

function persist() {
  runtime?.writer.schedule(JSON.stringify({ ids: ids() }));
}

function update(next: string[]) {
  const prev = ids();
  if (next.length === prev.length && next.every((id, i) => id === prev[i])) return;
  setIds(next);
  persist();
}

function clean(list: unknown[]): string[] {
  const out: string[] = [];
  for (const id of list) {
    if (typeof id === "string" && id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, MAX_OPEN);
}

export const openStore = {
  ids,
  has: (id: string) => ids().includes(id),

  /** Adds a script at the top; already open scripts keep their place. */
  add(id: string) {
    autoClosed.delete(id);
    if (ids().includes(id)) return;
    // Over the cap the oldest entry makes room.
    update([id, ...ids()].slice(0, MAX_OPEN));
  },

  remove(id: string) {
    pendingClose.delete(id);
    update(ids().filter((x) => x !== id));
  },

  /** Keeps only `keep` (or nothing). */
  removeAllExcept(keep: string | null) {
    pendingClose.clear();
    update(keep && ids().includes(keep) ? [keep] : []);
  },

  /** Drops scripts that no longer exist (trashed, deleted). */
  reconcile(live: Set<string>) {
    update(ids().filter((id) => live.has(id)));
  },

  /**
   * Applies the finish rule after the library reloaded. Only a change INTO
   * the final stage closes a script, so one the writer reopens by hand
   * stays. The script on screen (`activeId`) is only marked and closes when
   * the writer switches away (`leave`). Undoing the change in time brings
   * an automatically closed script back to its old place.
   */
  syncStatuses(scripts: readonly { id: string; status: string }[], finalId: string, activeId: string | null, enabled: boolean) {
    const previous = lastStatus;
    lastStatus = new Map(scripts.map((s) => [s.id, s.status]));
    if (!previous) return;
    const now = Date.now();
    let next = ids();
    for (const s of scripts) {
      const before = previous.get(s.id);
      if (before === undefined || before === s.status) continue;
      const finished = s.status === finalId && before !== finalId;
      if (finished && enabled && next.includes(s.id)) {
        if (s.id === activeId) pendingClose.add(s.id);
        else {
          autoClosed.set(s.id, { index: next.indexOf(s.id), at: now });
          next = next.filter((x) => x !== s.id);
        }
        continue;
      }
      if (s.status !== finalId) {
        pendingClose.delete(s.id);
        const closed = autoClosed.get(s.id);
        if (before === finalId && closed && now - closed.at <= REOPEN_WINDOW_MS && !next.includes(s.id)) {
          next = [...next];
          next.splice(Math.min(closed.index, next.length), 0, s.id);
        }
        autoClosed.delete(s.id);
      }
    }
    update(next);
  },

  /** The script view moved on from `id`: close it if it finished meanwhile. */
  leave(id: string | null) {
    if (!id || !pendingClose.has(id)) return;
    pendingClose.delete(id);
    update(ids().filter((x) => x !== id));
  },

  /** Restores the stored list; `seed` fills an install that never stored one. */
  async load(seed: () => string[], isActive: () => boolean = () => true): Promise<void> {
    const current = runtime ?? (startOpenStore(), runtime!);
    try {
      const raw = await current.kv.getAppState(OPEN_KEY);
      if (!current.active || !isActive()) return;
      if (raw === null) {
        update(clean(seed().slice(0, SEED_COUNT)));
        return;
      }
      const parsed = JSON.parse(raw) as { ids?: unknown };
      setIds(Array.isArray(parsed.ids) ? clean(parsed.ids) : []);
    } catch {
      /* a malformed list starts empty */
    }
  },
};
