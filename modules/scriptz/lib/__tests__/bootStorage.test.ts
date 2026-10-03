import { describe, expect, it, vi } from "vitest";
import type { KvStore } from "@agentz/kit/platform";
import type { ScriptzStorage } from "../storage";
import { ensureWelcomeContent } from "../welcome";
import { LEGACY_BLOCKS_MIGRATION_FLAG, migrateLegacyBlocksOnce } from "../legacyBlocksMigration";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function memory() {
  const values = new Map<string, string>();
  const getAppState = vi.fn(async (key: string) => values.get(key) ?? null);
  const setAppState = vi.fn(async (key: string, value: string) => { values.set(key, value); });
  const kv: KvStore = { getAppState, setAppState, getSetting: async () => null, setSetting: async () => {} };
  const listScripts = vi.fn(async () => [] as { id: string }[]);
  const createScript = vi.fn(async () => ({ id: "welcome" }));
  const getScript = vi.fn(async () => ({ content_json: JSON.stringify({ root: { children: [{ type: "scriptz-sfx", children: [] }] } }) }));
  const updateScript = vi.fn(async () => ({}));
  const storage = { listScripts, createScript, getScript, updateScript } as unknown as ScriptzStorage;
  return { kv, storage, values, getAppState, setAppState, listScripts, createScript, getScript, updateScript };
}

describe("boot storage lifetime", () => {
  it("serializes concurrent welcome seeds for the same store", async () => {
    const m = memory();
    await Promise.all([
      ensureWelcomeContent({ kv: m.kv, storage: m.storage }),
      ensureWelcomeContent({ kv: m.kv, storage: m.storage }),
    ]);
    expect(m.createScript).toHaveBeenCalledTimes(1);
    expect(m.values.get("welcome_seeded_v3")).toBe("1");
    expect(m.values.get("welcome_script_id_v1")).toBe("welcome");
  });

  it("cancels welcome work after an in-flight read and lets the next boot seed", async () => {
    const m = memory();
    const pending = deferred<{ id: string }[]>();
    m.listScripts.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const old = ensureWelcomeContent({ kv: m.kv, storage: m.storage, signal: controller.signal });
    await vi.waitFor(() => expect(m.listScripts).toHaveBeenCalledOnce());
    controller.abort();
    const next = ensureWelcomeContent({ kv: m.kv, storage: m.storage });
    pending.resolve([]);
    await Promise.all([old, next]);
    expect(m.createScript).toHaveBeenCalledTimes(1);
    expect(m.setAppState).toHaveBeenCalledTimes(2);
  });

  it("does not write markers after an aborted in-flight welcome creation", async () => {
    const m = memory();
    const pending = deferred<{ id: string }>();
    m.createScript.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const work = ensureWelcomeContent({ kv: m.kv, storage: m.storage, signal: controller.signal });
    await vi.waitFor(() => expect(m.createScript).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve({ id: "old-welcome" });
    await work;
    expect(m.setAppState).not.toHaveBeenCalled();
  });

  it("runs migrations for different stores independently while an old flag read is pending", async () => {
    const old = memory();
    const next = memory();
    const pending = deferred<string | null>();
    old.getAppState.mockReturnValueOnce(pending.promise);
    const oldWork = migrateLegacyBlocksOnce({ kv: old.kv, storage: old.storage });
    await migrateLegacyBlocksOnce({ kv: next.kv, storage: next.storage });
    expect(next.values.has(LEGACY_BLOCKS_MIGRATION_FLAG)).toBe(true);
    expect(old.setAppState).not.toHaveBeenCalled();
    pending.resolve(null);
    await oldWork;
    expect(old.values.has(LEGACY_BLOCKS_MIGRATION_FLAG)).toBe(true);
    expect(next.setAppState).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite content or set a marker when cancelled during a content read", async () => {
    const m = memory();
    m.listScripts.mockResolvedValue([{ id: "old" }]);
    const pending = deferred<{ content_json: string }>();
    m.getScript.mockReturnValueOnce(pending.promise);
    const controller = new AbortController();
    const work = migrateLegacyBlocksOnce({ kv: m.kv, storage: m.storage, signal: controller.signal });
    await vi.waitFor(() => expect(m.getScript).toHaveBeenCalledOnce());
    controller.abort();
    pending.resolve({ content_json: '{"root":{"children":[{"type":"scriptz-sfx","children":[]}]}}' });
    await work;
    expect(m.updateScript).not.toHaveBeenCalled();
    expect(m.setAppState).not.toHaveBeenCalled();
  });
});
