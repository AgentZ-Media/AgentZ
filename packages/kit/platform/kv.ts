import type { DbConnection } from "./platform";

/** String preferences and runtime state shared by the host and its module.
 * Database names, schema migrations and product records belong to the host/module. */
export interface KvStore {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getAppState(key: string): Promise<string | null>;
  setAppState(key: string, value: string): Promise<void>;
}

/** Creating the adapter never opens the database. The provider is evaluated for
 * each operation, after the host has registered its platform connection. */
export function createSqlKvStore(getDb: () => Promise<DbConnection>): KvStore {
  async function read(table: "settings" | "app_state", key: string): Promise<string | null> {
    const db = await getDb();
    const rows = await db.select<{ value: string }[]>(
      `SELECT value FROM ${table} WHERE key = $1`,
      [key],
    );
    return rows.length > 0 ? rows[0].value : null;
  }

  async function write(table: "settings" | "app_state", key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.execute(
      `INSERT INTO ${table} (key, value) VALUES ($1, $2) ` +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  return {
    getSetting: (key) => read("settings", key),
    setSetting: (key, value) => write("settings", key, value),
    getAppState: (key) => read("app_state", key),
    setAppState: (key, value) => write("app_state", key, value),
  };
}

let store: KvStore | null = null;

/** Explicit host registration, before starting settings or module runtimes. */
export function setKvStore(value: KvStore): void {
  store = value;
}

export function getKvStore(): KvStore {
  if (!store) throw new Error("KvStore not set. The host must call setKvStore() before boot.");
  return store;
}

/** Resolve the active store per call, preserving custom adapter receivers. */
export const kvStore: KvStore = {
  getSetting: (key) => getKvStore().getSetting(key),
  setSetting: (key, value) => getKvStore().setSetting(key, value),
  getAppState: (key) => getKvStore().getAppState(key),
  setAppState: (key, value) => getKvStore().setAppState(key, value),
};
