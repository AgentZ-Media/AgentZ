// Account and cloud sync contracts. The Kit owns sign-in, encryption and the
// sync engine; a module only describes its local data (SyncAdapter).

/** Public endpoints of the suite backend. Not secrets: every build ships them. */
export interface CloudConfig {
  /** Convex deployment for queries and mutations (`https://<name>.convex.cloud`). */
  convexUrl: string;
  /** HTTP routes of the same deployment: auth and app sign-in (`.convex.site`). */
  siteUrl: string;
  /** Website with the app sign-in page (`/konto/app/`). */
  webUrl: string;
}

export type { SecretStore } from "../platform";

export interface AccountUser {
  id: string;
  name: string;
  email: string;
}

/** One local record as the engine sees it; `record` is null for a deletion. */
export interface SyncChange {
  entity: string;
  id: string;
  record: unknown | null;
}

export interface LocalChangeBatch {
  changes: SyncChange[];
  /** Cursor after this batch; passed back as `after` next time. */
  nextCursor: number;
  /** True when the batch was cut at `limit` and more changes follow. */
  more: boolean;
}

/** A record from the cloud, decrypted. `record` is null for a deletion. */
export interface RemoteChange {
  entity: string;
  id: string;
  record: unknown | null;
}

/**
 * Version of the synced data. A version writes one format and reads every
 * format up to `reads` (always including all older ones). Additive changes
 * (new fields, entities or settings) need no new format: older versions keep
 * unknown fields and park unknown records. Only a change older versions would
 * misread raises it, in two releases: first `reads`, then `writes`
 * (docs/cloud-sync.md, "Versionen und Kompatibilität").
 */
export interface SyncFormat {
  reads: number;
  writes: number;
}

/** What a device reports to the backend with every sync call. */
export interface SyncClient extends SyncFormat {
  /** App version, SemVer. */
  version: string;
  /** "stable", "nightly" or "dev" (development server). */
  channel: string;
}

/**
 * Why the backend pauses this device's sync until it is updated: another
 * device wrote a newer format (`by` is its app version), or the backend no
 * longer accepts this version.
 */
export type SyncBlock =
  | { reason: "format"; format: number; by: string | null }
  | { reason: "version"; minVersion: string | null };

export interface SyncContext {
  /** Random ID of this device for the signed-in account. */
  deviceId: string;
}

/**
 * What a module tells the Kit about its data. The local database stays the
 * working copy; the cloud copy is the truth once the user is signed in.
 *
 * Contract:
 * - `readChanges` returns records changed after a local cursor, with their
 *   complete current content. Records may repeat; the engine skips records
 *   whose content it already synced.
 * - `apply` writes cloud records into the local database without losing
 *   anything that depends on them, and refreshes the UI. It returns the
 *   records it could not write yet because a record they reference has not
 *   arrived; the engine retries them later in the same pull and finally
 *   calls `apply(..., { force: true })`.
 * - `keepLocalCopy` runs when a local version loses a conflict against the
 *   cloud: the module may keep it as a copy (a script "(conflict copy)").
 * - A record passed to `apply` may lack fields of `fields` (written by an
 *   older version): those columns keep their local value or default.
 */
export interface SyncAdapter {
  /** Entity names in dependency order: referenced entities first. */
  entities: readonly string[];
  format: SyncFormat;
  /**
   * Fields of each entity's records this version understands. Fields of cloud
   * records beyond these come from newer versions: the engine keeps them and
   * sends them back unchanged with every upload of that record.
   */
  fields: Readonly<Record<string, readonly string[]>>;
  /** Highest local change cursor; polled to notice new local writes. */
  localCursor(): Promise<number>;
  readChanges(after: number, limit: number, context: SyncContext): Promise<LocalChangeBatch>;
  /** Current local version of a record, or null if it does not exist. */
  read(entity: string, id: string, context: SyncContext): Promise<unknown | null>;
  apply(changes: RemoteChange[], context: SyncContext & { force: boolean }): Promise<RemoteChange[]>;
  /** Returns the local ID of the copy, so fields this version does not know stay with it. */
  keepLocalCopy?(entity: string, id: string, record: unknown): Promise<string | void>;
  /** Settings keys (KvStore) synced across devices; device-only keys stay out. */
  settings?: {
    keys: readonly string[];
    /** Reload whatever reads these keys after the cloud changed them. */
    changed(keys: string[]): void | Promise<void>;
  };
}
