import { flushAll } from "../lib";
import type { KvStore } from "../platform";
import { bookKey, DELETED, writeSyncState, type BookEntry, type SyncBook, type SyncState } from "./book";
import { canonicalJson, decodeRecord, encodeRecord, recordIdOf, sha256Base64Url, toArrayBuffer, type Envelope } from "./records";
import { errorCode, SessionExpiredError } from "./http";
import type { CloudTransport, PushResult, WireChange, WireRecord } from "./transport";
import type { RemoteChange, SyncAdapter, SyncChange } from "./types";

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
  transport: CloudTransport;
  book: SyncBook;
  kv: KvStore;
  /** Mutated in place and persisted after every confirmed step. */
  state: SyncState;
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
}

interface Decoded extends RemoteChange {
  remoteId: string;
  rev: number;
  hash: string;
}

const hashOf = (envelope: Envelope | null) =>
  envelope ? sha256Base64Url(canonicalJson(envelope)) : Promise.resolve(DELETED);

export function createSyncEngine(options: EngineOptions) {
  const { app, adapter, transport, book, kv, state } = options;
  const order = new Map<string, number>([[SETTINGS_ENTITY, -1], ...adapter.entities.map((entity, index) => [entity, index] as const)]);
  const settingKeys = new Set(adapter.settings?.keys ?? []);
  const context = () => ({ deviceId: state.deviceId });
  const save = () => writeSyncState(kv, state);

  async function envelopeOf(change: SyncChange): Promise<Envelope | null> {
    return change.record === null ? null : { entity: change.entity, id: change.id, record: change.record };
  }

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
      const envelope = await envelopeOf(change);
      const hash = await hashOf(envelope);
      const entry = known.get(key);
      if (entry?.hash === hash) continue;
      // Never synced and gone again: the cloud never knew it.
      if (!entry && !envelope) continue;
      out.push({
        entity: change.entity, id: change.id, envelope, hash,
        remoteId: entry?.remoteId ?? recordIdOf(change.entity, change.id),
        baseRev: entry?.rev ?? 0,
      });
    }
    return out;
  }

  async function toWire(candidate: Candidate): Promise<WireChange> {
    if (!candidate.envelope) return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: true, size: 0 };
    const bytes = await encodeRecord(candidate.envelope);
    if (bytes.length <= INLINE_LIMIT) {
      return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: false, data: toArrayBuffer(bytes), size: bytes.length };
    }
    const blob = await transport.upload(bytes);
    return { recordId: candidate.remoteId, baseRev: candidate.baseRev, deleted: false, blob, size: bytes.length };
  }

  async function decode(record: WireRecord, known?: BookEntry): Promise<Decoded | null> {
    if (record.deleted) {
      if (!known) return null;
      return { entity: known.entity, id: known.id, record: null, remoteId: record.recordId, rev: record.rev, hash: DELETED };
    }
    const bytes = record.data ? new Uint8Array(record.data) : record.blobUrl ? await transport.download(record.blobUrl) : null;
    if (!bytes) return null;
    const envelope = await decodeRecord(bytes);
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
      const { results } = await transport.push(app, state.deviceId, wires);
      const done: BookEntry[] = [];
      const byId = new Map(results.map((result) => [result.recordId, result]));
      for (const candidate of batch) {
        const result = byId.get(candidate.remoteId);
        if (!result) continue;
        if (result.status === "ok") {
          done.push({ entity: candidate.entity, id: candidate.id, remoteId: candidate.remoteId, rev: result.rev, hash: candidate.hash });
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
    const current = result.current;
    // The cloud lost the record or deleted it: the local edit wins.
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
    await adapter.keepLocalCopy(entity, id, record);
    copied = true;
    options.onConflictCopy?.(entity);
  }

  async function push(): Promise<void> {
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
    await book.put(list
      .filter((item) => !waitingKeys.has(bookKey(item.entity, item.id)))
      .map((item) => ({ entity: item.entity, id: item.id, remoteId: item.remoteId, rev: item.rev, hash: item.hash })));
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

  async function pull(): Promise<void> {
    const unsynced = await unsyncedKeys();
    let waiting: Decoded[] = [];
    // Paging runs ahead of the saved cursor: records waiting for a parent hold
    // the saved cursor back, never the next page.
    let fetched = state.pulled;
    for (;;) {
      const page = await transport.pull(app, fetched);
      if (page.records.length === 0) break;
      const deletedIds = page.records.filter((record) => record.deleted).map((record) => record.recordId);
      const knownByRemote = await book.byRemoteIds(deletedIds);
      const decoded: Decoded[] = [];
      for (const record of page.records) {
        // End-to-end encrypted records of older app versions are unreadable.
        if (record.keyId) continue;
        const item = await decode(record, knownByRemote.get(record.recordId));
        if (item) decoded.push(item);
      }
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
          const localHash = await hashOf(local === null ? null : { entity: item.entity, id: item.id, record: local });
          if (localHash === item.hash) { bookOnly.push({ entity: item.entity, id: item.id, remoteId: item.remoteId, rev: item.rev, hash: item.hash }); continue; }
          // Deleted in the cloud, edited here: the edit wins and goes up next cycle.
          if (item.record === null && local !== null) {
            bookOnly.push({ entity: item.entity, id: item.id, remoteId: item.remoteId, rev: item.rev, hash: DELETED });
            continue;
          }
          if (local !== null) await keepCopy(item.entity, item.id, local);
        }
        apply.push(item);
      }
      await book.put(bookOnly);
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
        if (errorCode(error) === "UNAUTHENTICATED") throw new SessionExpiredError();
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
