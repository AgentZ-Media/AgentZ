import type { KvStore } from "../platform";
import { registerFlusher } from "../lib";

interface KeyWrites { revision: number; acknowledged: number; tail: Promise<void> }
const adapters = new WeakMap<KvStore, Map<string, KeyWrites>>();
function writesFor(kv: KvStore, key: string): KeyWrites {
  let keys = adapters.get(kv);
  if (!keys) { keys = new Map(); adapters.set(kv, keys); }
  let state = keys.get(key);
  if (!state) { state = { revision: 0, acknowledged: 0, tail: Promise.resolve() }; keys.set(key, state); }
  return state;
}

/** One runtime owns its writes and their original adapter, even after teardown.
 * Runtime instances sharing a key serialize together; a successful newer value
 * supersedes old failed work, so a later retry cannot roll the preference back. */
export function createSettingsWriter(kv: KvStore, name: string) {
  const writes = new Map<string, Promise<void>>();
  const failed = new Map<string, { value: string; revision: number }>();
  let disposed = false;
  let unregister = () => {};
  const release = () => {
    if (disposed && writes.size === 0 && failed.size === 0) unregister();
  };
  const enqueue = (key: string, value: string, revision: number): Promise<void> => {
    const state = writesFor(kv, key);
    const pending = state.tail.catch(() => {}).then(async () => {
      if (state.acknowledged > revision) { failed.delete(key); return; }
      try {
        await kv.setSetting(key, value);
        state.acknowledged = revision;
        failed.delete(key);
      } catch (error) {
        failed.set(key, { value, revision });
        throw error;
      }
    });
    state.tail = pending;
    writes.set(key, pending);
    void pending.catch(() => {}).finally(() => {
      if (writes.get(key) === pending) writes.delete(key);
      release();
    });
    return pending;
  };
  const write = (key: string, value: string) => enqueue(key, value, ++writesFor(kv, key).revision);
  const flush = async () => {
    // Retry only failures known at the start. A fresh failure must remain
    // visible to the caller instead of being hidden by an immediate retry.
    const retry = [...failed].filter(([key]) => !writes.has(key));
    for (const [key, entry] of retry) void enqueue(key, entry.value, entry.revision).catch(() => {});
    while (writes.size) await Promise.allSettled([...writes.values()]);
    release();
    return { ok: failed.size === 0 };
  };
  unregister = registerFlusher(flush, name);
  return { write, flush, dispose() { disposed = true; release(); } };
}
