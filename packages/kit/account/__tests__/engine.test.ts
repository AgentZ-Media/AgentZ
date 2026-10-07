// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { KvStore } from "../../platform";
import { createMemorySyncBook, RECORD_SCHEME, type SyncState } from "../book";
import { ClientOutdatedError } from "../http";
import { createSyncEngine, INLINE_LIMIT } from "../engine";
import type { CloudTransport, PushResult, WireChange, WireRecord } from "../transport";
import type { RemoteChange, SyncAdapter, SyncBlock, SyncChange, SyncClient, SyncFormat } from "../types";

// A fake cloud with the semantics of apps/site/convex/sync.ts, including the
// format gate of compat.ts.
function createServer() {
  let head = 0;
  let format = 0;
  let formatBy: string | null = null;
  const records = new Map<string, WireRecord>();
  /** legacyRank of records written by a migration upload (sync.ts). */
  const ranks = new Map<string, number>();
  const blobs = new Map<string, Uint8Array>();
  const pushes: WireChange[] = [];
  /** Fault injection: the pull call with this number (1-based) fails once. */
  let failPull = 0;
  let pulls = 0;
  const reports: Record<string, number>[] = [];
  let reportFails = false;
  const outdated = (client: SyncClient) => {
    if (client.reads >= format) return null;
    return Object.assign(new Error("outdated"), { data: { code: "CLIENT_OUTDATED", block: { reason: "format", format, by: formatBy } } });
  };
  return {
    pushes,
    records,
    reports,
    format: () => format,
    failPullNumber(n: number) { failPull = n; pulls = 0; },
    failReports(fail: boolean) { reportFails = fail; },
    /** A record as older app versions wrote it, end-to-end encrypted. */
    addEncrypted() {
      head += 1;
      records.set(`legacy${head}`, { recordId: `legacy${head}`, rev: head, deleted: false, data: new Uint8Array([1, 0, 7]).buffer, keyId: "old-key", deviceId: "X" });
    },
    transport(): CloudTransport {
      return {
        head: async (_app, client) => {
          const error = outdated(client);
          return { rev: head, block: error ? error.data.block as SyncBlock : null };
        },
        watchHead: () => () => {},
        async pull(_app, client, afterRev) {
          const error = outdated(client);
          if (error) throw error;
          pulls += 1;
          if (failPull && pulls === failPull) { failPull = 0; throw new Error("network lost"); }
          const list = [...records.values()].filter((r) => r.rev > afterRev).sort((a, b) => a.rev - b.rev);
          const page = list.slice(0, 2);
          return { records: page.map((r) => ({ ...r })), headRev: head, more: list.length > page.length };
        },
        async push(_app, client, deviceId, changes) {
          const error = outdated(client);
          if (error) throw error;
          const results: PushResult[] = [];
          let wroteContent = false;
          for (const change of changes) {
            pushes.push(change);
            const existing = records.get(change.recordId);
            const current = existing?.rev ?? 0;
            const stored = ranks.get(change.recordId);
            const outranks = change.legacyRank !== undefined && stored !== undefined && stored % 2 === 0 && change.legacyRank > stored;
            if (change.baseRev !== current && !outranks) {
              if (existing?.deleted && change.deleted) results.push({ recordId: change.recordId, status: "ok", rev: existing.rev });
              else results.push({ recordId: change.recordId, status: "conflict", rev: current, current: existing ? { ...existing, legacyRank: stored } : null });
              continue;
            }
            head += 1;
            if (!change.deleted) wroteContent = true;
            if (change.legacyRank === undefined) ranks.delete(change.recordId);
            else ranks.set(change.recordId, change.legacyRank);
            records.set(change.recordId, {
              recordId: change.recordId, rev: head, deleted: change.deleted, data: change.data,
              blobUrl: change.blob ? `blob:${change.blob}` : undefined, deviceId,
            });
            results.push({ recordId: change.recordId, status: "ok", rev: head });
          }
          if (wroteContent && client.writes > format) { format = client.writes; formatBy = client.version; }
          return { results, headRev: head };
        },
        async upload(_app, _client, bytes) {
          const id = `b${blobs.size + 1}`;
          blobs.set(id, bytes);
          return id;
        },
        download: async (url) => blobs.get(url.slice(5))!,
        async report(_app, client, counts) {
          const error = outdated(client);
          if (error) throw error;
          if (reportFails) throw new Error("offline");
          reports.push({ ...counts });
        },
        connected: () => true,
        close: () => {},
      };
    },
  };
}

type Row = Record<string, unknown> & { id: string; title?: string; parentId?: string | null };

interface DeviceSchema {
  /** Fields per entity, in dependency order; a table stores only these columns. */
  fields: Record<string, readonly string[]>;
  settings: readonly string[];
  format: SyncFormat;
}

const V1: DeviceSchema = {
  fields: { parents: ["id", "title"], children: ["id", "title", "parentId"] },
  settings: ["stages"],
  format: { reads: 1, writes: 1 },
};

// A newer version: children gained "mood", a new entity "notes" (optionally
// inside a parent) and a new setting.
const V2: DeviceSchema = {
  fields: { parents: ["id", "title"], children: ["id", "title", "parentId", "mood"], notes: ["id", "title", "parentId"] },
  settings: ["stages", "theme_accent"],
  format: { reads: 1, writes: 1 },
};

// A device: tables in memory that keep only their columns, like SQLite, and a
// coalesced change feed like local_changes. The book and tables survive an
// update (`upgrade`), as they would in the app's database.
function createDevice(name: string, initial: DeviceSchema = V1) {
  let schema = initial;
  const tables = new Map<string, Map<string, Row>>();
  const table = (entity: string) => {
    if (!tables.has(entity)) tables.set(entity, new Map());
    return tables.get(entity)!;
  };
  let seq = 0;
  const feed = new Map<string, { entity: string; id: string; seq: number }>();
  const mark = (entity: string, id: string) => feed.set(`${entity}:${id}`, { entity, id, seq: ++seq });
  const copies: string[] = [];
  const settings = new Map<string, string>();
  const appState = new Map<string, string>();
  const kv: KvStore = {
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => { settings.set(key, value); },
    getAppState: async (key) => appState.get(key) ?? null,
    setAppState: async (key, value) => { appState.set(key, value); },
  };
  /** Present known fields overwrite, missing ones keep their value (an UPDATE of the given columns). */
  const store = (entity: string, row: Record<string, unknown>) => {
    const columns = schema.fields[entity];
    const existing = table(entity).get(row.id as string);
    const next: Row = { ...(existing ?? {}), id: row.id as string };
    for (const column of columns) if (Object.hasOwn(row, column)) next[column] = row[column];
    for (const column of columns) if (!Object.hasOwn(next, column)) next[column] = null;
    table(entity).set(next.id, next);
  };
  const write = (entity: string, row: Row) => { store(entity, row); mark(entity, row.id); };
  const remove = (entity: string, id: string) => { table(entity).delete(id); mark(entity, id); };
  const adapter = (): SyncAdapter => ({
    entities: Object.keys(schema.fields),
    format: schema.format,
    fields: schema.fields,
    stats: async () => ({ children: table("children").size }),
    localCursor: async () => seq,
    async readChanges(after, limit) {
      const list = [...feed.values()].filter((c) => c.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
      const changes: SyncChange[] = list.map((c) => ({ entity: c.entity, id: c.id, record: table(c.entity).get(c.id) ?? null }));
      return { changes, nextCursor: list.at(-1)?.seq ?? after, more: list.length === limit };
    },
    read: async (entity, id) => table(entity).get(id) ?? null,
    async apply(changes, { force }) {
      const waiting: RemoteChange[] = [];
      for (const change of changes) {
        if (change.record === null) { remove(change.entity, change.id); continue; }
        const row = { ...(change.record as Row) };
        if ((change.entity === "children" || change.entity === "notes") && row.parentId && !table("parents").has(row.parentId)) {
          if (!force) { waiting.push(change); continue; }
          row.parentId = null;
        }
        write(change.entity, row);
      }
      return waiting;
    },
    async keepLocalCopy(entity, _id, record) {
      const row = record as Row;
      const copy = { ...row, id: `${row.id}-copy-${name}`, title: `${row.title} (copy)` };
      write(entity, copy);
      copies.push(copy.id);
      return copy.id;
    },
    settings: { keys: schema.settings, changed: () => {} },
  });
  return {
    tables: {
      get parents() { return table("parents"); },
      get children() { return table("children"); },
      get notes() { return table("notes"); },
    },
    write, remove, adapter, kv, settings, copies, feed, book: createMemorySyncBook(),
    /** Installs a newer version: new columns exist from now on, with their defaults. */
    upgrade(next: DeviceSchema) {
      schema = next;
      for (const [entity, rows] of tables) {
        for (const row of rows.values()) for (const column of next.fields[entity] ?? []) if (!Object.hasOwn(row, column)) row[column] = null;
      }
    },
  };
}

type Device = ReturnType<typeof createDevice>;

async function connect(device: Device, server: ReturnType<typeof createServer>, deviceId: string, version = "1.0.0") {
  const saved = await device.kv.getAppState("test.state");
  const state: SyncState = saved
    ? JSON.parse(saved) as SyncState
    : { userId: "u", email: "u@x", keyId: RECORD_SCHEME, deviceId, pushed: 0, pulled: 0, lastSyncedAt: null };
  const adapter = device.adapter();
  const client: SyncClient = { version, channel: "stable", ...adapter.format };
  const engine = createSyncEngine({ app: "test", adapter, transport: server.transport(), book: device.book, kv: device.kv, state, client });
  const sync = engine.sync;
  // Persist cursors like the app does (sync.state), so an update keeps them.
  engine.sync = async () => { try { await sync(); } finally { await device.kv.setAppState("test.state", JSON.stringify(engine.state)); } };
  return engine;
}

describe("sync engine", () => {
  it("brings records to another device and never echoes them back", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("parents", { id: "p1", title: "Folder" });
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    a.settings.set("stages", "[1,2]");
    const syncA = await connect(a, server, "A");
    const syncB = await connect(b, server, "B");
    await syncA.sync();
    expect(server.records.size).toBe(3);
    await syncB.sync();
    expect(b.tables.children.get("c1")).toEqual({ id: "c1", title: "Script", parentId: "p1" });
    expect(b.settings.get("stages")).toBe("[1,2]");
    const before = server.pushes.length;
    await syncB.sync();
    await syncA.sync();
    expect(server.pushes.length).toBe(before);
  });

  it("keeps the cloud version and the local one as a copy when both changed", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, "A");
    const syncB = await connect(b, server, "B");
    await syncA.sync();
    await syncB.sync();
    // Both edit while the other is offline; A uploads first.
    a.write("children", { id: "c1", title: "from A" });
    b.write("children", { id: "c1", title: "from B" });
    await syncA.sync();
    await syncB.sync();
    expect(b.tables.children.get("c1")?.title).toBe("from A");
    expect(b.copies).toEqual(["c1-copy-b"]);
    expect(b.tables.children.get("c1-copy-b")?.title).toBe("from B (copy)");
    await syncA.sync();
    expect(a.tables.children.get("c1-copy-b")?.title).toBe("from B (copy)");
  });

  it("detects a conflict even when the other change arrives during the pull", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, "A");
    const syncB = await connect(b, server, "B");
    await syncA.sync();
    await syncB.sync();
    a.write("children", { id: "c1", title: "from A" });
    await syncA.sync();
    // B edits after its upload ran but before the pull: only the pull sees it.
    b.write("children", { id: "c1", title: "from B" });
    await syncB.pull();
    expect(b.tables.children.get("c1")?.title).toBe("from A");
    expect(b.copies).toHaveLength(1);
  });

  it("lets an edit win against a deletion on another device", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, "A");
    const syncB = await connect(b, server, "B");
    await syncA.sync();
    await syncB.sync();
    a.remove("children", "c1");
    b.write("children", { id: "c1", title: "edited" });
    await syncA.sync();
    await syncB.sync();
    expect(b.tables.children.get("c1")?.title).toBe("edited");
    await syncA.sync();
    expect(a.tables.children.get("c1")?.title).toBe("edited");
  });

  it("deletes everywhere and skips records that never reached the cloud", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    a.write("children", { id: "tmp", title: "temp" });
    a.remove("children", "tmp");
    const syncA = await connect(a, server, "A");
    const syncB = await connect(b, server, "B");
    await syncA.sync();
    expect(server.records.size).toBe(1);
    await syncB.sync();
    b.remove("children", "c1");
    await syncB.sync();
    await syncA.sync();
    expect(a.tables.children.has("c1")).toBe(false);
  });

  it("waits with a child until its parent arrived, even on a later page", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    const syncA = await connect(a, server, "A");
    a.write("parents", { id: "p1", title: "Folder" });
    a.write("children", { id: "x1", title: "filler" });
    a.write("children", { id: "x2", title: "filler" });
    await syncA.sync();
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    await syncA.sync();
    // Renaming the parent moves it behind its child in revision order.
    a.write("parents", { id: "p1", title: "Renamed" });
    await syncA.sync();
    const fresh = createDevice("b2");
    const syncB = await connect(fresh, server, "B");
    await syncB.sync();
    expect(fresh.tables.children.get("c1")?.parentId).toBe("p1");
    expect(fresh.tables.parents.get("p1")?.title).toBe("Renamed");
    void b;
  });

  it("keeps paging while a child waits for a parent several pages later", async () => {
    const server = createServer();
    const a = createDevice("a");
    const syncA = await connect(a, server, "A");
    a.write("parents", { id: "p1", title: "Folder" });
    await syncA.sync();
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    for (let i = 0; i < 6; i++) a.write("children", { id: `x${i}`, title: "filler" });
    await syncA.sync();
    // The parent's newest revision now lies three pages behind its child.
    a.write("parents", { id: "p1", title: "Renamed" });
    await syncA.sync();
    const b = createDevice("b");
    const syncB = await connect(b, server, "B");
    await syncB.sync();
    expect(b.tables.children.get("c1")?.parentId).toBe("p1");
    expect(b.tables.children.size).toBe(7);
    expect(syncB.state.pulled).toBe(Math.max(...[...server.records.values()].map((r) => r.rev)));
  }, 5000);

  it("moves large records through file storage", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    // Random text does not compress below the inline limit.
    const big = Array.from({ length: INLINE_LIMIT / 2 }, () => Math.random().toString(36).slice(2, 8)).join("");
    a.write("children", { id: "c1", title: big });
    await (await connect(a, server, "A")).sync();
    const stored = [...server.records.values()][0];
    expect(stored.data).toBeUndefined();
    expect(stored.blobUrl).toBeTruthy();
    await (await connect(b, server, "B")).sync();
    expect(b.tables.children.get("c1")?.title).toBe(big);
  });

  it("skips end-to-end encrypted records of older app versions", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    server.addEncrypted();
    a.write("children", { id: "c1", title: "Script" });
    await (await connect(a, server, "A")).sync();
    const syncB = await connect(b, server, "B");
    await syncB.sync();
    expect([...b.tables.children.keys()]).toEqual(["c1"]);
    expect(syncB.state.pulled).toBe(2);
  });

  it("reports the adapter's totals only when they changed and never fails a cycle over them", async () => {
    const server = createServer();
    const a = createDevice("a");
    a.write("children", { id: "c1", title: "Script" });
    const syncA = await connect(a, server, "A");
    await syncA.sync();
    await syncA.sync();
    expect(server.reports).toEqual([{ children: 1 }]);
    a.write("children", { id: "c2", title: "Script" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.failReports(true);
    await syncA.sync();
    expect(server.records.size).toBe(2);
    server.failReports(false);
    warn.mockRestore();
    await syncA.sync();
    expect(server.reports).toEqual([{ children: 1 }, { children: 2 }]);
  });
});

describe("data from newer versions", () => {
  it("keeps fields an older version does not know, even when it edits the record", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    const syncOld = await connect(older, server, "O");
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    await syncNew.sync();
    await syncOld.sync();
    expect(older.tables.children.get("c1")).toEqual({ id: "c1", title: "Script", parentId: null });
    older.write("children", { id: "c1", title: "Edited on the old device" });
    await syncOld.sync();
    await syncNew.sync();
    expect(newer.tables.children.get("c1")).toMatchObject({ title: "Edited on the old device", mood: "calm" });
    // Nothing echoes back and forth.
    const pushes = server.pushes.length;
    await syncOld.sync();
    await syncNew.sync();
    await syncOld.sync();
    expect(server.pushes.length).toBe(pushes);
  });

  it("parks unknown entities and settings, drops them when deleted and applies them after the update", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    newer.write("notes", { id: "n1", title: "Note" });
    newer.write("notes", { id: "n2", title: "Deleted later" });
    newer.settings.set("theme_accent", "blue");
    await syncNew.sync();
    await (await connect(older, server, "O")).sync();
    expect(older.tables.notes.size).toBe(0);
    expect(older.settings.has("theme_accent")).toBe(false);
    expect(older.book.parkedRecords.size).toBe(3);
    newer.remove("notes", "n2");
    await syncNew.sync();
    await (await connect(older, server, "O")).sync();
    expect(older.book.parkedRecords.size).toBe(2);

    older.upgrade(V2);
    const updated = await connect(older, server, "O", "1.1.0");
    await updated.sync();
    expect(older.tables.notes.get("n1")).toEqual({ id: "n1", title: "Note", parentId: null });
    expect(older.tables.notes.has("n2")).toBe(false);
    expect(older.settings.get("theme_accent")).toBe("blue");
    expect(older.book.parkedRecords.size).toBe(0);
    const pushes = server.pushes.length;
    await updated.sync();
    expect(server.pushes.length).toBe(pushes);
    // Later changes arrive normally.
    newer.write("notes", { id: "n1", title: "Renamed" });
    await syncNew.sync();
    await updated.sync();
    expect(older.tables.notes.get("n1")?.title).toBe("Renamed");
  });

  it("fills a field the update learned before anything is uploaded", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    newer.write("children", { id: "c2", title: "Other", mood: "tense" });
    await syncNew.sync();
    await (await connect(older, server, "O")).sync();

    // Installed the update, typed into c1 and quit before the first sync ran.
    older.upgrade(V2);
    older.write("children", { id: "c1", title: "Typed after the update" });
    expect(older.tables.children.get("c1")?.mood).toBeNull();
    const updated = await connect(older, server, "O", "1.1.0");
    const pushes = server.pushes.length;
    await updated.push();
    expect(older.tables.children.get("c1")).toMatchObject({ title: "Typed after the update", mood: "calm" });
    expect(older.tables.children.get("c2")).toMatchObject({ title: "Other", mood: "tense" });
    // Only the edited record went up, with the cloud's mood.
    expect(server.pushes.length).toBe(pushes + 1);
    await syncNew.sync();
    expect(newer.tables.children.get("c1")).toMatchObject({ title: "Typed after the update", mood: "calm" });
    expect(newer.tables.children.get("c2")).toMatchObject({ mood: "tense" });
    expect(await older.book.withExtra()).toEqual([]);
  });

  it("resolves a conflict on a record with fields the old version does not know", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    const syncOld = await connect(older, server, "O");
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    await syncNew.sync();
    await syncOld.sync();
    // The old device edits locally while the newer one changes the record.
    older.write("children", { id: "c1", title: "Old edit" });
    newer.write("children", { id: "c1", title: "New edit", mood: "calm" });
    await syncNew.sync();
    await syncOld.sync();
    expect(older.copies).toEqual(["c1-copy-old"]);
    expect(older.tables.children.get("c1")?.title).toBe("New edit");
    await syncNew.sync();
    expect(newer.tables.children.get("c1")).toMatchObject({ title: "New edit", mood: "calm" });
  });

  it("stops with the reason when the account holds a format this version cannot read", async () => {
    const server = createServer();
    const next = createDevice("next", { ...V2, format: { reads: 2, writes: 2 } });
    const bridge = createDevice("bridge", { ...V2, format: { reads: 2, writes: 1 } });
    const older = createDevice("old", V1);
    next.write("children", { id: "c1", title: "Script" });
    await (await connect(next, server, "X", "2.0.0-nightly.202611011200")).sync();
    expect(server.format()).toBe(2);
    const error = await (await connect(older, server, "O")).sync().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ClientOutdatedError);
    expect((error as ClientOutdatedError).block).toEqual({ reason: "format", format: 2, by: "2.0.0-nightly.202611011200" });
    expect(older.tables.children.size).toBe(0);
    // A version that reads the new format but still writes the old one syncs.
    await (await connect(bridge, server, "B", "1.5.0")).sync();
    expect(bridge.tables.children.get("c1")?.title).toBe("Script");
    expect(server.format()).toBe(2);
  });

  it("keeps a learned field the user set after the update, before the first sync", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    await syncNew.sync();
    await (await connect(older, server, "O")).sync();
    older.upgrade(V2);
    older.write("children", { id: "c1", title: "Script", mood: "angry" });
    await (await connect(older, server, "O", "1.1.0")).sync();
    expect(older.tables.children.get("c1")?.mood).toBe("angry");
    await syncNew.sync();
    expect(newer.tables.children.get("c1")?.mood).toBe("angry");
  });

  it("lets a parked record wait for its parent when the pull that parked it broke off", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    newer.write("parents", { id: "p0", title: "Filler" });
    newer.write("notes", { id: "n1", title: "Note", parentId: "p1" });
    await syncNew.sync();
    // The parent arrives in the cloud after the note: a later page.
    newer.write("parents", { id: "p1", title: "Folder" });
    newer.write("parents", { id: "p2", title: "Filler" });
    await syncNew.sync();
    server.failPullNumber(2);
    await expect((await connect(older, server, "O")).sync()).rejects.toThrow("network lost");
    expect(older.book.parkedRecords.size).toBe(1);
    expect(older.tables.parents.has("p1")).toBe(false);

    older.upgrade(V2);
    const updated = await connect(older, server, "O", "1.1.0");
    await updated.push();
    // Not applied before its parent is here.
    expect(older.tables.notes.has("n1")).toBe(false);
    await updated.sync();
    expect(older.tables.notes.get("n1")).toEqual({ id: "n1", title: "Note", parentId: "p1" });
    expect(older.book.parkedRecords.size).toBe(0);
    await syncNew.sync();
    expect(newer.tables.notes.get("n1")?.parentId).toBe("p1");
  });

  it("uploads fields and records of newer versions again when the cloud copy is replaced", async () => {
    const oldCloud = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    newer.write("notes", { id: "n1", title: "Note" });
    await (await connect(newer, oldCloud, "N", "1.1.0")).sync();
    await (await connect(older, oldCloud, "O")).sync();
    // The local data moves to another account: an empty cloud, and the newer
    // device is gone. Record IDs stay the same in the new cloud.
    const newCloud = createServer();
    await older.book.resetForNewCloud();
    await older.kv.setAppState("test.state", JSON.stringify({ userId: "u2", email: "u2@x", keyId: RECORD_SCHEME, deviceId: "O", pushed: 0, pulled: 0, lastSyncedAt: null }));
    const moved = await connect(older, newCloud, "O");
    // Right after the upload (before any pull) the record is still parked,
    // under the same record ID as before.
    await moved.push();
    expect([...older.book.parkedRecords.values()]).toMatchObject([{ remoteId: "notes/n1", upload: false }]);
    await moved.sync();
    expect(older.book.parkedRecords.size).toBe(1);
    const fresh = createDevice("fresh", V2);
    await (await connect(fresh, newCloud, "F", "1.1.0")).sync();
    expect(fresh.tables.children.get("c1")).toMatchObject({ title: "Script", mood: "calm" });
    expect(fresh.tables.notes.get("n1")).toMatchObject({ title: "Note" });
    // And nothing goes up twice.
    const pushes = newCloud.pushes.length;
    await (await connect(older, newCloud, "O")).sync();
    expect(newCloud.pushes.length).toBe(pushes);
  });

  it.each(["older", "newer"] as const)("lets the newest synced version win when several devices migrate, the %s state first", async (first) => {
    // Stand-in for the end-to-end encrypted cloud: both devices synced there,
    // B saw more of it than A before the switch.
    const oldCloud = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("parents", { id: "p1", title: "Folder" });
    a.write("children", { id: "c1", title: "v1" });
    a.write("children", { id: "c2", title: "Deleted later" });
    a.write("children", { id: "c3", title: "v1" });
    const oldA = await connect(a, oldCloud, "A");
    const oldB = await connect(b, oldCloud, "B");
    await oldA.sync();
    await oldB.sync();
    b.write("parents", { id: "p1", title: "Renamed on B" });
    b.write("children", { id: "c1", title: "v2 from B" });
    b.remove("children", "c2");
    b.write("children", { id: "c3", title: "v2 from B" });
    await oldB.sync();
    // A never pulled B's changes and edits c3 on its older state.
    a.write("children", { id: "c3", title: "A's edit on v1" });

    const migrate = async (device: Device, id: string) => {
      await device.book.startMigration();
      await device.kv.setAppState("test.state", JSON.stringify({ userId: "u", email: "u@x", keyId: RECORD_SCHEME, deviceId: id, pushed: 0, pulled: 0, lastSyncedAt: null }));
    };
    const newCloud = createServer();
    await migrate(a, "A");
    await migrate(b, "B");
    const newA = await connect(a, newCloud, "A");
    const newB = await connect(b, newCloud, "B");
    const [one, two] = first === "older" ? [newA, newB] : [newB, newA];
    await one.sync();
    await two.sync();
    await one.sync();
    for (const device of [a, b]) {
      expect(device.tables.parents.get("p1")?.title).toBe("Renamed on B");
      expect(device.tables.children.get("c1")?.title).toBe("v2 from B");
      expect(device.tables.children.has("c2")).toBe(false);
      // A's change on v1 and B's v2 both count: the first upload stays,
      // the other becomes a copy, like any conflict.
      const [main, copy, copyId] = first === "older"
        ? ["A's edit on v1", "v2 from B (copy)", "c3-copy-b"]
        : ["v2 from B", "A's edit on v1 (copy)", "c3-copy-a"];
      expect(device.tables.children.get("c3")?.title).toBe(main);
      expect(device.tables.children.get(copyId)?.title).toBe(copy);
    }
    // Older unchanged versions just yield, without copies.
    expect([...a.copies, ...b.copies]).toEqual([first === "older" ? "c3-copy-b" : "c3-copy-a"]);
    // Done: nothing waits for a migration upload and nothing goes up again.
    expect(await a.book.legacy()).toEqual([]);
    expect(await b.book.legacy()).toEqual([]);
    const pushes = newCloud.pushes.length;
    await newA.sync();
    await newB.sync();
    expect(newCloud.pushes.length).toBe(pushes);
  });

  it("uploads migration entries the change feed does not bring", async () => {
    const oldCloud = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "From A" });
    await (await connect(a, oldCloud, "A")).sync();
    await (await connect(b, oldCloud, "B")).sync();
    // B's feed only knows what it wrote itself, like remote daily word counts.
    b.feed.clear();
    await b.book.startMigration();
    await b.kv.setAppState("test.state", JSON.stringify({ userId: "u", email: "u@x", keyId: RECORD_SCHEME, deviceId: "B", pushed: 0, pulled: 0, lastSyncedAt: null }));
    const newCloud = createServer();
    await (await connect(b, newCloud, "B")).sync();
    const fresh = createDevice("fresh");
    await (await connect(fresh, newCloud, "F")).sync();
    expect(fresh.tables.children.get("c1")?.title).toBe("From A");
  });

  it("moves bookkeeping of end-to-end encrypted versions over without losing newer data", async () => {
    const server = createServer();
    const older = createDevice("old", V1);
    // What an end-to-end encrypted version left behind: booked records with
    // opaque IDs, an unknown field and a parked record, and its key ID as scheme.
    older.write("children", { id: "c1", title: "Script" });
    older.book.entries.set("children\u0000c1", { entity: "children", id: "c1", remoteId: "hmac-c1", rev: 4, hash: "old", extra: { mood: "calm" } });
    await older.book.park([{ remoteId: "hmac-n1", entity: "notes", id: "n1", rev: 5, hash: "old", record: { id: "n1", title: "Note" } }]);
    server.addEncrypted();
    await older.book.startMigration();
    await older.kv.setAppState("test.state", JSON.stringify({ userId: "u", email: "u@x", keyId: RECORD_SCHEME, deviceId: "O", pushed: 0, pulled: 0, lastSyncedAt: null }));
    await (await connect(older, server, "O")).sync();
    const fresh = createDevice("fresh", V2);
    await (await connect(fresh, server, "F", "1.1.0")).sync();
    expect(fresh.tables.children.get("c1")).toMatchObject({ title: "Script", mood: "calm" });
    expect(fresh.tables.notes.get("n1")).toMatchObject({ title: "Note" });
    expect([...older.book.parkedRecords.keys()]).toEqual(["notes/n1"]);
  });

  it("keeps unknown fields with a conflict copy", async () => {
    const server = createServer();
    const newer = createDevice("new", V2);
    const older = createDevice("old", V1);
    const syncNew = await connect(newer, server, "N", "1.1.0");
    const syncOld = await connect(older, server, "O");
    newer.write("children", { id: "c1", title: "Script", mood: "calm" });
    await syncNew.sync();
    await syncOld.sync();
    newer.write("children", { id: "c1", title: "New edit", mood: "tense" });
    await syncNew.sync();
    older.write("children", { id: "c1", title: "Old edit" });
    await syncOld.push();
    await syncOld.sync();
    expect(older.copies).toEqual(["c1-copy-old"]);
    await syncNew.sync();
    expect(newer.tables.children.get("c1-copy-old")).toMatchObject({ title: "Old edit (copy)", mood: "calm" });
    expect(newer.tables.children.get("c1")).toMatchObject({ title: "New edit", mood: "tense" });
  });
});
