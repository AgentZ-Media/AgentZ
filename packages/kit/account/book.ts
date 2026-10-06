import type { DbConnection, KvStore } from "../platform";

// Local bookkeeping of the sync: which cloud revision and content hash each
// local record had when it was last synced, plus cursors. The table
// `sync_records` comes from the app's migrations (baseline for new apps).

export interface BookEntry {
  entity: string;
  id: string;
  /** Opaque server record ID. */
  remoteId: string;
  rev: number;
  /** Hash of the synced content; DELETED for a synced deletion. */
  hash: string;
}

export const DELETED = "-";

export interface SyncState {
  /** Account the local data was last synced with. */
  userId: string;
  /** Shown when another account signs in on this device. */
  email: string;
  /** Data key the bookkeeping belongs to; a new key starts over. */
  keyId: string;
  deviceId: string;
  /** Local change cursor up to which everything was uploaded. */
  pushed: number;
  /** Cloud revision up to which everything was applied. */
  pulled: number;
  lastSyncedAt: number | null;
}

const STATE_KEY = "sync.state";

export async function readSyncState(kv: KvStore): Promise<SyncState | null> {
  const raw = await kv.getAppState(STATE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SyncState;
    return typeof value.userId === "string" && typeof value.deviceId === "string" ? value : null;
  } catch {
    return null;
  }
}

export const writeSyncState = (kv: KvStore, state: SyncState) => kv.setAppState(STATE_KEY, JSON.stringify(state));

export interface SyncBook {
  getMany(keys: readonly { entity: string; id: string }[]): Promise<Map<string, BookEntry>>;
  byRemoteIds(remoteIds: readonly string[]): Promise<Map<string, BookEntry>>;
  put(entries: readonly BookEntry[]): Promise<void>;
  clear(): Promise<void>;
}

export const bookKey = (entity: string, id: string) => `${entity}\u0000${id}`;

interface Row { entity: string; entity_id: string; remote_id: string; rev: number; hash: string }
const toEntry = (row: Row): BookEntry => ({ entity: row.entity, id: row.entity_id, remoteId: row.remote_id, rev: row.rev, hash: row.hash });

const CHUNK = 200;

export function createSqlSyncBook(getDb: () => Promise<DbConnection>): SyncBook {
  return {
    async getMany(keys) {
      const out = new Map<string, BookEntry>();
      const db = await getDb();
      for (let i = 0; i < keys.length; i += CHUNK) {
        const chunk = keys.slice(i, i + CHUNK).map((key) => [key.entity, key.id]);
        const rows = await db.select<Row[]>(
          `SELECT r.entity, r.entity_id, r.remote_id, r.rev, r.hash
           FROM json_each($1) j
           JOIN sync_records r ON r.entity = json_extract(j.value, '$[0]') AND r.entity_id = json_extract(j.value, '$[1]')`,
          [JSON.stringify(chunk)],
        );
        for (const row of rows) out.set(bookKey(row.entity, row.entity_id), toEntry(row));
      }
      return out;
    },
    async byRemoteIds(remoteIds) {
      const out = new Map<string, BookEntry>();
      const db = await getDb();
      for (let i = 0; i < remoteIds.length; i += CHUNK) {
        const rows = await db.select<Row[]>(
          `SELECT r.entity, r.entity_id, r.remote_id, r.rev, r.hash
           FROM json_each($1) j JOIN sync_records r ON r.remote_id = j.value`,
          [JSON.stringify(remoteIds.slice(i, i + CHUNK))],
        );
        for (const row of rows) out.set(row.remote_id, toEntry(row));
      }
      return out;
    },
    async put(entries) {
      if (entries.length === 0) return;
      const db = await getDb();
      for (let i = 0; i < entries.length; i += CHUNK) {
        const chunk = entries.slice(i, i + CHUNK).map((e) => [e.entity, e.id, e.remoteId, e.rev, e.hash]);
        await db.execute(
          `INSERT INTO sync_records (entity, entity_id, remote_id, rev, hash)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                  json_extract(value, '$[3]'), json_extract(value, '$[4]')
           FROM json_each($1) WHERE true
           ON CONFLICT(entity, entity_id) DO UPDATE SET
             remote_id = excluded.remote_id, rev = excluded.rev, hash = excluded.hash`,
          [JSON.stringify(chunk)],
        );
      }
    },
    async clear() {
      const db = await getDb();
      await db.execute("DELETE FROM sync_records");
    },
  };
}

/** In-memory book for tests and hosts without a database table. */
export function createMemorySyncBook(): SyncBook & { entries: Map<string, BookEntry> } {
  const entries = new Map<string, BookEntry>();
  return {
    entries,
    async getMany(keys) {
      const out = new Map<string, BookEntry>();
      for (const key of keys) {
        const entry = entries.get(bookKey(key.entity, key.id));
        if (entry) out.set(bookKey(key.entity, key.id), { ...entry });
      }
      return out;
    },
    async byRemoteIds(remoteIds) {
      const wanted = new Set(remoteIds);
      const out = new Map<string, BookEntry>();
      for (const entry of entries.values()) if (wanted.has(entry.remoteId)) out.set(entry.remoteId, { ...entry });
      return out;
    },
    async put(list) {
      for (const entry of list) entries.set(bookKey(entry.entity, entry.id), { ...entry });
    },
    async clear() {
      entries.clear();
    },
  };
}
