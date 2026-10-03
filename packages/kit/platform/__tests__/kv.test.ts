import { describe, expect, it, vi } from "vitest";
import { createSqlKvStore, getKvStore, kvStore, setKvStore, type KvStore } from "../kv";
import type { DbConnection } from "../platform";

function connection() {
  const select = vi.fn<DbConnection["select"]>().mockResolvedValue([]);
  const execute = vi.fn<DbConnection["execute"]>().mockResolvedValue({ rowsAffected: 1 });
  const getDb = vi.fn().mockResolvedValue({ select, execute });
  return { select, execute, getDb };
}

describe("SQL key-value storage", () => {
  it("does not open a connection when constructed or registered", () => {
    const db = connection();
    const store = createSqlKvStore(db.getDb);
    setKvStore(store);
    expect(getKvStore()).toBe(store);
    expect(db.getDb).not.toHaveBeenCalled();
  });

  it.each([
    ["getSetting", "settings"],
    ["getAppState", "app_state"],
  ] as const)("%s distinguishes a missing value from an empty one and binds keys", async (method, table) => {
    const db = connection();
    const store = createSqlKvStore(db.getDb);
    const key = "x'; DROP TABLE settings; --";
    expect(await store[method](key)).toBeNull();
    db.select.mockResolvedValueOnce([{ value: "" }]);
    expect(await store[method](key)).toBe("");
    expect(db.select).toHaveBeenLastCalledWith(`SELECT value FROM ${table} WHERE key = $1`, [key]);
  });

  it.each([
    ["setSetting", "settings"],
    ["setAppState", "app_state"],
  ] as const)("%s upserts without interpolating keys or values", async (method, table) => {
    const db = connection();
    const store = createSqlKvStore(db.getDb);
    const key = "quote'key";
    const value = '{"text":"quoted\' value","active":false}';
    await store[method](key, value);
    expect(db.execute).toHaveBeenCalledWith(
      `INSERT INTO ${table} (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  });

  it("propagates database errors to the caller", async () => {
    const db = connection();
    const store = createSqlKvStore(db.getDb);
    db.execute.mockRejectedValueOnce(new Error("disk full"));
    await expect(store.setSetting("theme", "dark")).rejects.toThrow("disk full");
    db.getDb.mockRejectedValueOnce(new Error("connection unavailable"));
    await expect(store.getAppState("route")).rejects.toThrow("connection unavailable");
  });

  it("resolves replacement stores for existing callers and preserves this", async () => {
    const store = {
      value: "first",
      async getSetting() { return this.value; },
      async setSetting(_key: string, value: string) { this.value = value; },
      async getAppState() { return this.value; },
      async setAppState(_key: string, value: string) { this.value = value; },
    } satisfies KvStore & { value: string };
    setKvStore(store);
    expect(await kvStore.getSetting("theme")).toBe("first");
    const replacement = { ...store, value: "second" };
    setKvStore(replacement);
    await kvStore.setAppState("route", "third");
    expect(await kvStore.getAppState("route")).toBe("third");
    expect(store.value).toBe("first");
  });

  it("import leaves registration empty", async () => {
    vi.resetModules();
    const module = await import("../kv");
    expect(() => module.getKvStore()).toThrow("KvStore not set");
  });
});
