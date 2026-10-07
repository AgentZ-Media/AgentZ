import { v } from "convex/values";

// Apps that sync into this deployment, each with its own record table
// (schema.ts). A new app adds its table there and its ID here.
export const SYNC_APPS = {
  scriptz: "scriptz_records",
} as const;

export type SyncApp = keyof typeof SYNC_APPS;

/** Totals an app may report for the website's public counters (stats.ts). */
export const STAT_KEYS: Record<SyncApp, readonly string[]> = {
  scriptz: ["scripts"],
};
/**
 * Oldest sync format the server accepts per app (compat.ts). A version that
 * writes an older one gets CLIENT_OUTDATED like a version below the policy's
 * minimum. ScriptZ format 1 was end-to-end encrypted (records with `keyId`,
 * `sync_keys`); those records are deleted (sync.dropEncrypted). A new app
 * starts with 1.
 */
export const MIN_FORMAT: Record<SyncApp, number> = {
  scriptz: 2,
};
export type RecordTable = (typeof SYNC_APPS)[SyncApp];

export const appArg = v.union(v.literal("scriptz"));

export const isSyncApp = (value: unknown): value is SyncApp =>
  typeof value === "string" && Object.hasOwn(SYNC_APPS, value);

/** Record data above this size goes to file storage. Small enough that a full
 * pull page stays well below the 16 MiB a query may read. */
export const INLINE_LIMIT = 96 * 1024;
/** Upper bound for one record, inline or as a file. */
export const RECORD_LIMIT = 16 * 1024 * 1024;
/** Records per push and pull call. */
export const BATCH_LIMIT = 100;
/** Inline bytes returned by one pull call. */
export const PULL_BYTES = 4 * 1024 * 1024;
