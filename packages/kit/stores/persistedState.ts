import { createSerialSaver, registerFlusher } from "../lib";
import type { KvStore } from "../platform";

// Different lifetimes may still share a database adapter. Coordinate their
// writes so an older failed teardown cannot overwrite a newer draft later.
const channels = new WeakMap<KvStore, Map<string, { revision: number; tail: Promise<void> }>>();
function channelFor(kv: KvStore, key: string) {
  let keys = channels.get(kv);
  if (!keys) { keys = new Map(); channels.set(kv, keys); }
  let channel = keys.get(key);
  if (!channel) { channel = { revision: 0, tail: Promise.resolve() }; keys.set(key, channel); }
  return channel;
}

/** One runtime's buffered state. Its captured adapter and last payload survive
 * disposal until persisted or superseded by a newer draft for that same key. */
export function createStatePersistence(kv: KvStore, key: string, delayMs = 0) {
  const channel = channelFor(kv, key);
  let draft = { value: "", revision: 0 };
  let disposed = false;
  const saver = createSerialSaver({
    initial: draft,
    read: () => draft,
    write: async (value) => {
      const pending = channel.tail.then(async () => {
        if (value.revision === channel.revision) await kv.setAppState(key, value.value);
      });
      channel.tail = pending.catch(() => {});
      await pending;
      return value;
    },
    delayMs,
  });
  const flush = async () => {
    const result = await saver.flush(disposed ? "teardown" : "flush");
    if (disposed && result.ok) unregister();
    return result;
  };
  const unregister = registerFlusher(flush, key, "state");
  return {
    schedule(value: string) {
      if (disposed) return;
      draft = { value, revision: ++channel.revision };
      saver.schedule();
    },
    flush,
    dispose() {
      if (disposed) return;
      disposed = true;
      void flush();
    },
  };
}
