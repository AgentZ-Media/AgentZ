import { flushAll } from "../lib";
import type { KvStore } from "../platform";
import { bookKey, DELETED, writeSyncState, type BookEntry, type ParkedRecord, type SyncBook, type SyncState } from "./book";
import { canonicalJson, sha256Base64Url, toArrayBuffer, type Envelope, type RecordCipher } from "./crypto";
import { blockOf, ClientOutdatedError, errorCode, SessionExpiredError } from "./http";
import type { CloudTransport, PushResult, WireChange, WireRecord } from "./transport";
import type { RemoteChange, SyncAdapter, SyncChange, SyncClient } from "./types";

// The sync engine: the cloud is the truth, the local database the working copy.
//
// One cycle uploads local changes first, then applies the cloud's changes.
// - Every upload names the revision it was based on. If the cloud moved on
//   meanwhile, the cloud version wins and the local version is kept as a copy
//   where the module supports it (keepLocalCopy). Timestamps never decide.
// - An edit wins against a deletion on the other side: nothing is lost.
// - Content already in the cloud (same hash) is never uploaded again, which
//   also stops records written by a pull from echoing back.
// - Cursors advance only after the server confirmed a batch.
// - Data from newer app versions survives an older version (book.ts): fields
//   it does not know travel back up unchanged, records it does not know are
//   parked. After an update both reach the local tables in the first cycle.

/** Settings travel as records of this reserved entity. */
export const SETTINGS_ENTITY = "kit.settings";

const READ_BATCH = 100;
const PUSH_BYTES = 2 * 1024 * 1024;
const PUSH_COUNT = 100;
/** Must match INLINE_LIMIT in apps/site/convex/syncApps.ts. */
export const INLINE_LIMIT = 96 * 1024;

export interface EngineOptions {
  app: string;
  adapter: SyncAdapter;
  cipher: RecordCipher;
  transport: CloudTransport;
  book: SyncBook;
  kv: KvStore;
  /** Mutated in place and persisted after every confirmed step. */
  state: SyncState;
  /** Version and format of this device, sent with every call. */
  client: SyncClient;
  /** A local version lost against the cloud and was kept as a copy. */
  onConflictCopy?(entity: string): void;
}

interface Candidate {
  entity: string;
  id: string;
  remoteId: string;
  baseRev: number;
  hash: string;
  envelope: Envelope | null;
  /** Unknown fields merged into the envelope; kept for the next upload. */
  extra: Record<string, unknown> | null;
  /** A parked record uploaded again after the cloud copy was replaced. */
  parked?: ParkedRecord;
}

interface Decoded extends RemoteChange {
  remoteId: string;
  rev: number;
  hash: string;
}

const hashOf = (envelope: Envelope | null) =>
  envelope ? sha256Base64Url(canonicalJson(envelope)) : Promise.resolve(DELETED);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The local record with the cloud fields this version does not know. Known fields always come from the local record. */
const withExtra = (record: unknown, extra: Record<string, unknown> | null | undefined): unknown =>
  extra && isPlainObject(record) ? { ...extra, ...record } : record;

export function createSyncEngine(options: EngineOptions) {
  const { app, adapter, cipher, transport, book, kv, state, client } = options;
  const order = new Map<string, number>([[SETTINGS_ENTITY, -1], ...adapter.entities.map((entity, index) => [entity, index] as const)]);
  const settingKeys = new Set(adapter.settings?.keys ?? []);
  const fields = new Map<string, Set<string>>([
    [SETTINGS_ENTITY, new Set(["value"])],
    ...Object.entries(adapter.fields).map(([entity, list]) => [entity, new Set(list)] as const),
  ]);
  const context = () => ({ deviceId: state.deviceId });
  const save = () => writeSyncState(kv, state);

  /** Whether this version can apply records of this entity (or this setting). */
  const knows = (entity: string, id: string) => entity === SETTINGS_ENTITY ? settingKeys.has(id) : order.has(entity);

  /** Fields of a cloud record this version does not know, or null. */
  function extraOf(entity: string, record: unknown): Record<string, unknown> | null {
    const known = fields.get(entity);
    if (!known || !isPlainObject(record)) return null;
    const extra = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));
    return Object.keys(extra).length > 0 ? extra : null;
  }

  const entryOf = (item: Decoded): BookEntry =>
    ({ entity: item.entity, id: item.id, remoteId: item.remoteId, rev: item.rev, hash: item.hash, extra: extraOf(item.entity, item.record) });

  // ---- Upload ----

  async function localSettings(): Promise<SyncChange[]> {
    const keys = [...settingKeys];
    const values = await Promise.all(keys.map((key) => kv.getSetting(key)));
    return keys.flatMap((key, i) => (values[i] === null ? [] : [{ entity: SETTINGS_ENTITY, id: key, record: { value: values[i] } }]));
  }

  async function candidatesFor(changes: SyncChange[]): Promise<Candidate[]> {
    // The feed may repeat a record; the last version counts.
    const latest = new Map<string, SyncChange>();
    for (const change of changes) latest.set(bookKey(change.entity, change.id), change);
    const known = await book.getMany([...latest.values()]);
    const out: Candidate[] = [];
    for (const [key, change] of latest) {
      const entry = known.get(key);
      const extra = change.record === null ? null : entry?.extra ?? null;
      const envelope: Envelope | null = change.record === null
        ? null
        : { entity: change.entity, id: change.id, record: withExtra(change.record, extra) };
      const hash = await hashOf(envelope);
      if (entry?.hash === hash) continue;
      // Never synced and gone again: the cloud never knew it.
      if (!entry && !envelope) continue;
      out.push({
        entity: change.entity, id: change.id, envelope, hash, extra,
        // Empty after the cloud copy was replaced (book.resetForNewCloud).
        remoteId: entry?.remoteId || await cipher.recordId(change.entity, change.id),
        baseRev: entry?.rev ?? 0,
      });
    }
    return out;
  }

  async function toWire(candidate: Candidate): Promise<WireChange> {
    if (!candidate.envelope) return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: true, size: 0 };
    const sealed = await cipher.encrypt(candidate.remoteId, candidate.envelope);
    if (sealed.length <= INLINE_LIMIT) {
      return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: false, data: toArrayBuffer(sealed), size: sealed.length };
    }
    const blob = await transport.upload(app, client, sealed);
    return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: false, blob, size: sealed.length };
  }

  async function decode(record: WireRecord, known?: BookEntry): Promise<Decoded | null> {
    if (record.deleted) {
      if (!known) return null;
      return { entity: known.entity, id: known.id, record: null, remoteId: record.recordId, rev: record.rev, hash: DELETED };
    }
    const sealed = record.data ? new Uint8Array(record.data) : record.blobUrl ? await transport.download(record.blobUrl) : null;
    if (!sealed) return null;
    const envelope = await cipher.decrypt(record.recordId, sealed);
    return { entity: envelope.entity, id: envelope.id, record: envelope.record, remoteId: record.recordId, rev: record.rev, hash: await hashOf(envelope) };
  }

  /** Push candidates in size-bounded mutations; conflicts are resolved and retried. */
  async function upload(candidates: Candidate[], attempt = 0): Promise<void> {
    const retry: Candidate[] = [];
    let i = 0;
    while (i < candidates.length) {
      const batch: Candidate[] = [];
      const wires: WireChange[] = [];
      let bytes = 0;
      while (i < candidates.length && batch.length < PUSH_COUNT) {
        const wire = await toWire(candidates[i]);
        if (batch.length > 0 && bytes + (wire.data?.byteLength ?? 0) > PUSH_BYTES) break;
        bytes += wire.data?.byteLength ?? 0;
        batch.push(candidates[i]);
        wires.push(wire);
        i += 1;
      }
      const { results } = await transport.push(app, client, cipher.keyId, state.deviceId, wires);
      const done: BookEntry[] = [];
      const byId = new Map(results.map((result) => [result.recordId, result]));
      for (const candidate of batch) {
        const result = byId.get(candidate.remoteId);
        if (!result) continue;
        if (result.status === "ok" && candidate.parked) {
          // Still unknown to this version: it stays parked, now under the current key.
          await book.park([{ ...candidate.parked, remoteId: candidate.remoteId, rev: result.rev, upload: false }]);
          await book.unpark([candidate.parked.remoteId]);
        } else if (result.status === "ok") {
          done.push({ entity: candidate.entity, id: candidate.id, remoteId: candidate.remoteId, rev: result.rev, hash: candidate.hash, extra: candidate.extra });
        } else {
          const next = await resolvePushConflict(candidate, result);
          if (next) retry.push(next);
        }
      }
      await book.put(done);
    }
    if (retry.length > 0 && attempt < 3) await upload(retry, attempt + 1);
  }

  /** Returns a candidate to push again, or null once the cloud version is applied. */
  async function resolvePushConflict(candidate: Candidate, result: Extract<PushResult, { status: "conflict" }>): Promise<Candidate | null> {
    // Another device already uploaded this record again; the pull brings it.
    if (candidate.parked) {
      await book.unpark([candidate.parked.remoteId]);
      return null;
    }
    const current = result.current;
    // The cloud lost the record (key reset) or deleted it: the local edit wins.
    if (!current || current.deleted) {
      if (!candidate.envelope) {
        await book.put([{ entity: candidate.entity, id: candidate.id, remoteId: candidate.remoteId, rev: result.rev, hash: DELETED }]);
        return null;
      }
      return { ...candidate, baseRev: result.rev };
    }
    const remote = await decode(current);
    if (!remote) return null;
    if (remote.hash !== candidate.hash && candidate.envelope) {
      await keepCopy(candidate.entity, candidate.id, candidate.envelope.record);
    }
    await applyAll([remote]);
    return null;
  }

  let copied = false;
  async function keepCopy(entity: string, id: string, record: unknown) {
    if (entity === SETTINGS_ENTITY || !adapter.keepLocalCopy) return;
    const copyId = await adapter.keepLocalCopy(entity, id, record);
    // The copy keeps the fields this version does not know: they go up with it.
    const extra = extraOf(entity, record);
    if (typeof copyId === "string" && extra) {
      await book.put([{ entity, id: copyId, remoteId: "", rev: 0, hash: "", extra }]);
    }
    copied = true;
    options.onConflictCopy?.(entity);
  }

  /** Parked records whose cloud copy was replaced go up again under the current key. */
  async function uploadParked(): Promise<void> {
    const pending = (await book.parked()).filter((record) => record.upload);
    if (pending.length === 0) return;
    const candidates: Candidate[] = [];
    for (const record of pending) {
      const envelope: Envelope = { entity: record.entity, id: record.id, record: record.record };
      candidates.push({
        entity: record.entity, id: record.id, envelope, hash: await hashOf(envelope), extra: null, parked: record,
        remoteId: await cipher.recordId(record.entity, record.id), baseRev: 0,
      });
    }
    await upload(candidates);
  }

  async function push(): Promise<void> {
    // Before anything goes up: a field learned by an update must reach the
    // local row first, or its empty local column would overwrite the cloud.
    await adoptNewerData();
    await uploadParked();
    // Settings first: they are few and the content may depend on them (stages).
    await upload(await candidatesFor(await localSettings()));
    for (;;) {
      const batch = await adapter.readChanges(state.pushed, READ_BATCH, context());
      const candidates = await candidatesFor(batch.changes);
      if (candidates.length > 0) await upload(candidates);
      if (batch.nextCursor !== state.pushed) {
        state.pushed = batch.nextCursor;
        await save();
      }
      // Resolving conflicts writes locally (copies, cloud versions): read on
      // until only already synced records come back.
      if (!batch.more && candidates.length === 0) return;
    }
  }

  // ---- Download ----

  /** Applies cloud records in dependency order; returns those still waiting for a parent. */
  async function applyAll(list: Decoded[], force = false): Promise<Decoded[]> {
    const settings = list.filter((item) => item.entity === SETTINGS_ENTITY);
    const content = list.filter((item) => item.entity !== SETTINGS_ENTITY && order.has(item.entity));
    const changedKeys: string[] = [];
    for (const item of settings) {
      if (!settingKeys.has(item.id) || item.record === null) continue;
      const value = (item.record as { value?: unknown }).value;
      if (typeof value !== "string") continue;
      await kv.setSetting(item.id, value);
      changedKeys.push(item.id);
    }
    // Parents before children when writing, children before parents when deleting.
    const rank = (item: Decoded) => order.get(item.entity) ?? 0;
    const upserts = content.filter((item) => item.record !== null).sort((a, b) => rank(a) - rank(b));
    const deletes = content.filter((item) => item.record === null).sort((a, b) => rank(b) - rank(a));
    const waiting = upserts.length + deletes.length > 0
      ? await adapter.apply([...upserts, ...deletes].map(({ entity, id, record }) => ({ entity, id, record })), { ...context(), force })
      : [];
    const waitingKeys = new Set(waiting.map((item) => bookKey(item.entity, item.id)));
    const pending = content.filter((item) => waitingKeys.has(bookKey(item.entity, item.id)));
    await book.put(list.filter((item) => !waitingKeys.has(bookKey(item.entity, item.id))).map(entryOf));
    if (changedKeys.length > 0) await adapter.settings?.changed(changedKeys);
    return pending;
  }

  /** Records with local changes not uploaded yet (written during this cycle). */
  async function unsyncedKeys(): Promise<Set<string>> {
    const keys = new Set<string>();
    let cursor = state.pushed;
    for (let pages = 0; pages < 10; pages++) {
      const batch = await adapter.readChanges(cursor, READ_BATCH, context());
      for (const change of batch.changes) keys.add(bookKey(change.entity, change.id));
      cursor = batch.nextCursor;
      if (!batch.more) break;
    }
    return keys;
  }

  /**
   * Decides per cloud record against the local state: skip (already known),
   * only update the book (same content), or apply. A local edit not uploaded
   * yet that loses is kept as a copy first. Returns the records to apply.
   */
  async function integrate(decoded: Decoded[], unsynced: Set<string>): Promise<Decoded[]> {
    const known = await book.getMany(decoded);
    const apply: Decoded[] = [];
    const bookOnly: BookEntry[] = [];
    for (const item of decoded) {
      const key = bookKey(item.entity, item.id);
      const entry = known.get(key);
      if (entry && entry.rev >= item.rev) continue;
      if (entry?.hash === item.hash) { bookOnly.push({ ...entry, rev: item.rev }); continue; }
      if (unsynced.has(key) && item.entity !== SETTINGS_ENTITY) {
        const local = await adapter.read(item.entity, item.id, context());
        const merged = local === null ? null : { entity: item.entity, id: item.id, record: withExtra(local, entry?.extra) };
        if (await hashOf(merged) === item.hash) { bookOnly.push(entryOf(item)); continue; }
        // Deleted in the cloud, edited here: the edit wins and goes up next cycle.
        if (item.record === null && local !== null) {
          bookOnly.push({ entity: item.entity, id: item.id, remoteId: item.remoteId, rev: item.rev, hash: DELETED, extra: entry?.extra ?? null });
          continue;
        }
        if (merged !== null) await keepCopy(item.entity, item.id, merged.record);
      }
      apply.push(item);
    }
    await book.put(bookOnly);
    return apply;
  }

  // ---- Data from newer versions ----

  let adopted = false;

  /**
   * Applies parked records this version knows now, like freshly pulled ones.
   * Without `force` a record whose parent is still missing stays parked; the
   * end of a complete pull applies the rest with `force`.
   */
  async function applyParked(force: boolean): Promise<void> {
    const parked = (await book.parked()).filter((record) => !record.upload && knows(record.entity, record.id));
    if (parked.length === 0) return;
    const items: Decoded[] = parked.map((record) => ({
      entity: record.entity, id: record.id, record: record.record, remoteId: record.remoteId, rev: record.rev, hash: record.hash,
    }));
    const waiting = await applyAll(await integrate(items, await unsyncedKeys()), force);
    const stillWaiting = new Set(waiting.map((item) => item.remoteId));
    await book.unpark(parked.filter((record) => !stillWaiting.has(record.remoteId)).map((record) => record.remoteId));
  }

  /**
   * Once per engine (i.e. per app start), before the first upload: parked
   * records this version knows now are applied, and booked fields it knows
   * now reach the local rows. Local work only, no network.
   */
  async function adoptNewerData(): Promise<void> {
    if (adopted) return;
    await applyParked(false);
    const unsynced = await unsyncedKeys();
    for (const entry of await book.withExtra()) {
      const known = fields.get(entry.entity);
      if (!known || !entry.extra || !knows(entry.entity, entry.id) || entry.entity === SETTINGS_ENTITY) continue;
      const learned = Object.keys(entry.extra).filter((key) => known.has(key));
      if (learned.length === 0) continue;
      const rest = Object.fromEntries(Object.entries(entry.extra).filter(([key]) => !known.has(key)));
      const local = await adapter.read(entry.entity, entry.id, context());
      if (isPlainObject(local)) {
        // The local row equals the synced record in every field this version
        // knew; the new columns hold their default. Adding the learned values
        // restores the cloud version, its hash stays the booked one. A row
        // edited since the update keeps every learned field it already set.
        const edited = unsynced.has(bookKey(entry.entity, entry.id));
        const fill = learned.filter((key) => !edited || local[key] === null || local[key] === undefined);
        const record = { ...local, ...Object.fromEntries(fill.map((key) => [key, entry.extra![key]])) };
        const waiting = await adapter.apply([{ entity: entry.entity, id: entry.id, record }], { ...context(), force: true });
        if (waiting.length > 0) continue;
      }
      await book.put([{ ...entry, extra: Object.keys(rest).length > 0 ? rest : null }]);
    }
    adopted = true;
  }

  async function pull(): Promise<void> {
    await adoptNewerData();
    const unsynced = await unsyncedKeys();
    let waiting: Decoded[] = [];
    // Paging runs ahead of the saved cursor: records waiting for a parent hold
    // the saved cursor back, never the next page.
    let fetched = state.pulled;
    for (;;) {
      const page = await transport.pull(app, client, fetched);
      if (page.records.length === 0) break;
      const deletedIds = page.records.filter((record) => record.deleted).map((record) => record.recordId);
      const knownByRemote = await book.byRemoteIds(deletedIds);
      // A newer version of a parked record replaces it below (or applies it,
      // if this version knows it now); a deletion removes it for good.
      await book.unpark(page.records.map((record) => record.recordId));
      const decoded: Decoded[] = [];
      const parked: ParkedRecord[] = [];
      for (const record of page.records) {
        if (record.keyId !== cipher.keyId) continue;
        const item = await decode(record, knownByRemote.get(record.recordId));
        if (!item) continue;
        // Written by a newer version: kept, unapplied and unbooked, until an update knows it.
        if (item.record !== null && !knows(item.entity, item.id)) {
          parked.push({ remoteId: item.remoteId, entity: item.entity, id: item.id, rev: item.rev, hash: item.hash, record: item.record });
          continue;
        }
        decoded.push(item);
      }
      await book.park(parked);
      const apply = await integrate(decoded, unsynced);
      waiting = await applyAll([...waiting, ...apply]);
      const last = page.records[page.records.length - 1].rev;
      fetched = last;
      // Never move the saved cursor past a record that is still waiting.
      const floor = waiting.length > 0 ? Math.min(...waiting.map((item) => item.rev)) - 1 : last;
      const next = Math.max(state.pulled, Math.min(last, floor));
      if (next !== state.pulled) { state.pulled = next; await save(); }
      if (!page.more) {
        if (waiting.length > 0) {
          await applyAll(waiting, true);
          state.pulled = Math.max(state.pulled, last);
          await save();
        }
        break;
      }
    }
    // Every page is in: parked records still waiting for a parent get the same
    // final, forced attempt as pulled ones.
    await applyParked(true);
  }

  return {
    /** One full cycle. Throws SessionExpiredError or transport errors. */
    async sync(): Promise<void> {
      try {
        // Typing still buffered in an editor goes to the database first, so
        // a conflict with the cloud sees it and nothing is overwritten.
        await flushAll(2000, ["content"]).catch(() => undefined);
        copied = false;
        await push();
        await pull();
        // Copies kept during the pull go up right away.
        if (copied) await push();
        state.lastSyncedAt = Date.now();
        await save();
      } catch (error) {
        const code = errorCode(error);
        if (code === "UNAUTHENTICATED") throw new SessionExpiredError();
        if (code === "CLIENT_OUTDATED") throw new ClientOutdatedError(blockOf(error));
        throw error;
      }
    },
    /** Only the upload, for closing the app. */
    push,
    pull,
    state,
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
