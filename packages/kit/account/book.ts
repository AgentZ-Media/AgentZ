import type { DbConnection, KvStore } from "../platform";

// Local bookkeeping of the sync: which cloud revision and content hash each
// local record had when it was last synced, plus cursors. The tables
// `sync_records` and `sync_parked` come from the app's migrations (baseline
// for new apps).
//
// Two kinds of data from newer app versions are kept here instead of being
// lost (docs/cloud-sync.md, "Versionen und Kompatibilität"):
// - `extra`: fields of a synced record this version does not know. They go
//   back up with every upload of the record and reach the local table once an
//   update knows them.
// - parked records: whole records of an entity or setting this version does
//   not know. They wait, unapplied and unbooked, until an update knows them.

export interface BookEntry {
  entity: string;
  id: string;
  /** Server record ID (`<entity>/<id>`); empty while the cloud copy was replaced (resetForNewCloud, startMigration). */
  remoteId: string;
  /**
   * Cloud revision. With an empty remoteId and a rev above 0 it is the
   * revision of the end-to-end encrypted cloud this entry came from
   * (startMigration): the migration upload ranks by it.
   */
  rev: number;
  /** Hash of the synced content; DELETED for a synced deletion. */
  hash: string;
  /** Fields of the cloud record this version does not know; null if none. */
  extra?: Record<string, unknown> | null;
}

/** A cloud record of an entity or setting this version does not know. */
export interface ParkedRecord {
  remoteId: string;
  entity: string;
  id: string;
  rev: number;
  hash: string;
  record: unknown;
  /** The cloud copy was replaced (other account, end-to-end encrypted records dropped): upload it again. */
  upload?: boolean;
}

export const DELETED = "-";

export interface SyncState {
  /** Account the local data was last synced with. */
  userId: string;
  /** Shown when another account signs in on this device. */
  email: string;
  /**
   * Record scheme the bookkeeping belongs to (RECORD_SCHEME). End-to-end
   * encrypted versions stored their data key ID here; their bookkeeping is
   * migrated (book.startMigration). Named `keyId` in the stored JSON.
   */
  keyId: string;
  deviceId: string;
  /** Local change cursor up to which everything was uploaded. */
  pushed: number;
  /** Cloud revision up to which everything was applied. */
  pulled: number;
  lastSyncedAt: number | null;
}

const STATE_KEY = "sync.state";

/**
 * How record IDs and contents are encoded (records.ts). Only the local
 * bookkeeping depends on it; which data a version can read is the sync
 * format (SyncFormat), checked by the backend.
 */
export const RECORD_SCHEME = "plain-1";

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
  /** Entries that carry fields unknown when they were synced. */
  withExtra(): Promise<BookEntry[]>;
  /** Stores records; an existing one is only replaced by a newer revision. */
  park(records: readonly ParkedRecord[]): Promise<void>;
  parked(): Promise<ParkedRecord[]>;
  unpark(remoteIds: readonly string[]): Promise<void>;
  /** Forgets everything, parked records included. */
  clear(): Promise<void>;
  /**
   * The cloud copy is replaced (local data moved to another account, records
   * of end-to-end encrypted versions dropped): revisions and record IDs no
   * longer apply. Keeps what only
   * this device may still hold, fields and records of newer versions, so
   * they are uploaded again with everything else.
   */
  resetForNewCloud(): Promise<void>;
  /**
   * The cloud copy of an end-to-end encrypted version is replaced by plain
   * records: record IDs no longer apply, but every entry keeps its old
   * revision and hash. All devices of the account share that revision order,
   * so the migration upload can let the newest synced version win
   * (engine.ts, legacyRank) instead of whichever device migrates first.
   * Parked records go up again like after resetForNewCloud.
   */
  startMigration(): Promise<void>;
  /** Entries still waiting for their migration upload (empty remoteId, old rev above 0). */
  legacy(): Promise<BookEntry[]>;
}

export const bookKey = (entity: string, id: string) => `${entity}\u0000${id}`;

interface Row { entity: string; entity_id: string; remote_id: string; rev: number; hash: string; extra: string | null }
interface ParkedRow { remote_id: string; entity: string; entity_id: string; rev: number; hash: string; record: string; upload: number }

function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const toEntry = (row: Row): BookEntry => ({
  entity: row.entity, id: row.entity_id, remoteId: row.remote_id, rev: row.rev, hash: row.hash, extra: parseObject(row.extra),
});
const extraText = (extra: BookEntry["extra"]) => extra && Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;
const COLUMNS = "r.entity, r.entity_id, r.remote_id, r.rev, r.hash, r.extra";

const CHUNK = 200;

export function createSqlSyncBook(getDb: () => Promise<DbConnection>): SyncBook {
  return {
    async getMany(keys) {
      const out = new Map<string, BookEntry>();
      const db = await getDb();
      for (let i = 0; i < keys.length; i += CHUNK) {
        const chunk = keys.slice(i, i + CHUNK).map((key) => [key.entity, key.id]);
        const rows = await db.select<Row[]>(
          `SELECT ${COLUMNS}
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
          `SELECT ${COLUMNS}
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
        const chunk = entries.slice(i, i + CHUNK).map((e) => [e.entity, e.id, e.remoteId, e.rev, e.hash, extraText(e.extra)]);
        await db.execute(
          `INSERT INTO sync_records (entity, entity_id, remote_id, rev, hash, extra)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                  json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]')
           FROM json_each($1) WHERE true
           ON CONFLICT(entity, entity_id) DO UPDATE SET
             remote_id = excluded.remote_id, rev = excluded.rev, hash = excluded.hash, extra = excluded.extra`,
          [JSON.stringify(chunk)],
        );
      }
    },
    async withExtra() {
      const db = await getDb();
      const rows = await db.select<Row[]>(`SELECT ${COLUMNS} FROM sync_records r WHERE r.extra IS NOT NULL`);
      return rows.map(toEntry);
    },
    async park(records) {
      if (records.length === 0) return;
      const db = await getDb();
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK).map((p) => [p.remoteId, p.entity, p.id, p.rev, p.hash, JSON.stringify(p.record), p.upload ? 1 : 0]);
        await db.execute(
          `INSERT INTO sync_parked (remote_id, entity, entity_id, rev, hash, record, upload)
           SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'),
                  json_extract(value, '$[3]'), json_extract(value, '$[4]'), json_extract(value, '$[5]'),
                  json_extract(value, '$[6]')
           FROM json_each($1) WHERE true
           ON CONFLICT(remote_id) DO UPDATE SET
             entity = excluded.entity, entity_id = excluded.entity_id, rev = excluded.rev,
             hash = excluded.hash, record = excluded.record, upload = excluded.upload
           WHERE excluded.rev > sync_parked.rev`,
          [JSON.stringify(chunk)],
        );
      }
    },
    async parked() {
      const db = await getDb();
      const rows = await db.select<ParkedRow[]>("SELECT remote_id, entity, entity_id, rev, hash, record, upload FROM sync_parked ORDER BY rev");
      const out: ParkedRecord[] = [];
      for (const row of rows) {
        let record: unknown;
        try {
          record = JSON.parse(row.record);
        } catch {
          // A damaged row must not stop every sync; a newer cloud version replaces it.
          console.warn("[account] skipping an unreadable parked record", row.remote_id);
          continue;
        }
        out.push({ remoteId: row.remote_id, entity: row.entity, id: row.entity_id, rev: row.rev, hash: row.hash, record, upload: row.upload === 1 });
      }
      return out;
    },
    async unpark(remoteIds) {
      if (remoteIds.length === 0) return;
      const db = await getDb();
      for (let i = 0; i < remoteIds.length; i += CHUNK) {
        await db.execute(
          "DELETE FROM sync_parked WHERE remote_id IN (SELECT value FROM json_each($1))",
          [JSON.stringify(remoteIds.slice(i, i + CHUNK))],
        );
      }
    },
    async clear() {
      const db = await getDb();
      await db.execute("DELETE FROM sync_records");
      await db.execute("DELETE FROM sync_parked");
    },
    async resetForNewCloud() {
      const db = await getDb();
      await db.execute("DELETE FROM sync_records WHERE extra IS NULL");
      await db.execute("UPDATE sync_records SET remote_id = '', rev = 0, hash = ''");
      // rev 0 lets any copy the new cloud already has win over the re-upload.
      await db.execute("UPDATE sync_parked SET rev = 0, upload = 1");
    },
    async startMigration() {
      const db = await getDb();
      await db.execute("UPDATE sync_records SET remote_id = ''");
      await db.execute("UPDATE sync_parked SET rev = 0, upload = 1");
    },
    async legacy() {
      const db = await getDb();
      const rows = await db.select<Row[]>(`SELECT ${COLUMNS} FROM sync_records r WHERE r.remote_id = '' AND r.rev > 0`);
      return rows.map(toEntry);
    },
  };
}

const copyEntry = (entry: BookEntry): BookEntry => ({ ...entry, extra: entry.extra ? { ...entry.extra } : null });

/** In-memory book for tests and hosts without a database table. */
export function createMemorySyncBook(): SyncBook & { entries: Map<string, BookEntry>; parkedRecords: Map<string, ParkedRecord> } {
  const entries = new Map<string, BookEntry>();
  const parkedRecords = new Map<string, ParkedRecord>();
  return {
    entries,
    parkedRecords,
    async getMany(keys) {
      const out = new Map<string, BookEntry>();
      for (const key of keys) {
        const entry = entries.get(bookKey(key.entity, key.id));
        if (entry) out.set(bookKey(key.entity, key.id), copyEntry(entry));
      }
      return out;
    },
    async byRemoteIds(remoteIds) {
      const wanted = new Set(remoteIds);
      const out = new Map<string, BookEntry>();
      for (const entry of entries.values()) if (wanted.has(entry.remoteId)) out.set(entry.remoteId, copyEntry(entry));
      return out;
    },
    async put(list) {
      for (const entry of list) {
        const extra = entry.extra && Object.keys(entry.extra).length > 0 ? entry.extra : null;
        entries.set(bookKey(entry.entity, entry.id), copyEntry({ ...entry, extra }));
      }
    },
    async withExtra() {
      return [...entries.values()].filter((entry) => entry.extra).map(copyEntry);
    },
    async park(records) {
      for (const record of records) {
        const existing = parkedRecords.get(record.remoteId);
        if (!existing || record.rev > existing.rev) parkedRecords.set(record.remoteId, structuredClone(record));
      }
    },
    async parked() {
      return [...parkedRecords.values()].sort((a, b) => a.rev - b.rev).map((record) => structuredClone(record));
    },
    async unpark(remoteIds) {
      for (const id of remoteIds) parkedRecords.delete(id);
    },
    async clear() {
      entries.clear();
      parkedRecords.clear();
    },
    async resetForNewCloud() {
      for (const [key, entry] of entries) {
        if (!entry.extra) entries.delete(key);
        else entries.set(key, { ...entry, remoteId: "", rev: 0, hash: "" });
      }
      for (const [key, record] of parkedRecords) parkedRecords.set(key, { ...record, rev: 0, upload: true });
    },
    async startMigration() {
      for (const [key, entry] of entries) entries.set(key, { ...entry, remoteId: "" });
      for (const [key, record] of parkedRecords) parkedRecords.set(key, { ...record, rev: 0, upload: true });
    },
    async legacy() {
      return [...entries.values()].filter((entry) => !entry.remoteId && entry.rev > 0).map(copyEntry);
    },
  };
}
