// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KvStore } from "../../platform";
import { CLOUD_FORMAT, createMemorySyncBook, type SyncState } from "../book";
import { createSyncEngine, INLINE_LIMIT } from "../engine";
import type { CloudTransport, PushResult, WireChange, WireRecord } from "../transport";
import type { RemoteChange, SyncAdapter, SyncChange } from "../types";

// A fake cloud with the semantics of apps/site/convex/sync.ts.
function createServer() {
  let head = 0;
  const records = new Map<string, WireRecord>();
  const blobs = new Map<string, Uint8Array>();
  const pushes: WireChange[] = [];
  return {
    pushes,
    records,
    /** A record as older app versions wrote it, end-to-end encrypted. */
    addEncrypted() {
      head += 1;
      records.set(`legacy${head}`, { recordId: `legacy${head}`, rev: head, deleted: false, data: new Uint8Array([1, 0, 7]).buffer, keyId: "old-key", deviceId: "X" });
    },
    transport(): CloudTransport {
      return {
        head: async () => ({ rev: head }),
        watchHead: () => () => {},
        async pull(_app, afterRev) {
          const list = [...records.values()].filter((r) => r.rev > afterRev).sort((a, b) => a.rev - b.rev);
          const page = list.slice(0, 2);
          return { records: page.map((r) => ({ ...r })), headRev: head, more: list.length > page.length };
        },
        async push(_app, deviceId, changes) {
          const results: PushResult[] = [];
          for (const change of changes) {
            pushes.push(change);
            const existing = records.get(change.recordId);
            const current = existing?.rev ?? 0;
            if (change.baseRev !== current) {
              if (existing?.deleted && change.deleted) results.push({ recordId: change.recordId, status: "ok", rev: existing.rev });
              else results.push({ recordId: change.recordId, status: "conflict", rev: current, current: existing ? { ...existing } : null });
              continue;
            }
            head += 1;
            records.set(change.recordId, {
              recordId: change.recordId, rev: head, deleted: change.deleted, data: change.data,
              blobUrl: change.blob ? `blob:${change.blob}` : undefined, deviceId,
            });
            results.push({ recordId: change.recordId, status: "ok", rev: head });
          }
          return { results, headRev: head };
        },
        async upload(bytes) {
          const id = `b${blobs.size + 1}`;
          blobs.set(id, bytes);
          return id;
        },
        download: async (url) => blobs.get(url.slice(5))!,
        connected: () => true,
        close: () => {},
      };
    },
  };
}

interface Row { id: string; title: string; parentId?: string | null }

// A device: tables in memory and a coalesced change feed like local_changes.
function createDevice(name: string) {
  const tables = { parents: new Map<string, Row>(), children: new Map<string, Row>() };
  type Entity = keyof typeof tables;
  let seq = 0;
  const feed = new Map<string, { entity: Entity; id: string; seq: number }>();
  const mark = (entity: Entity, id: string) => feed.set(`${entity}:${id}`, { entity, id, seq: ++seq });
  const copies: string[] = [];
  const settings = new Map<string, string>();
  const appState = new Map<string, string>();
  const kv: KvStore = {
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => { settings.set(key, value); },
    getAppState: async (key) => appState.get(key) ?? null,
    setAppState: async (key, value) => { appState.set(key, value); },
  };
  const write = (entity: Entity, row: Row) => { tables[entity].set(row.id, { ...row }); mark(entity, row.id); };
  const remove = (entity: Entity, id: string) => { tables[entity].delete(id); mark(entity, id); };
  const adapter: SyncAdapter = {
    entities: ["parents", "children"],
    localCursor: async () => seq,
    async readChanges(after, limit) {
      const list = [...feed.values()].filter((c) => c.seq > after).sort((a, b) => a.seq - b.seq).slice(0, limit);
      const changes: SyncChange[] = list.map((c) => ({ entity: c.entity, id: c.id, record: tables[c.entity].get(c.id) ?? null }));
      return { changes, nextCursor: list.at(-1)?.seq ?? after, more: list.length === limit };
    },
    read: async (entity, id) => tables[entity as Entity].get(id) ?? null,
    async apply(changes, { force }) {
      const waiting: RemoteChange[] = [];
      for (const change of changes) {
        const entity = change.entity as Entity;
        if (change.record === null) { remove(entity, change.id); continue; }
        const row = change.record as Row;
        if (entity === "children" && row.parentId && !tables.parents.has(row.parentId)) {
          if (!force) { waiting.push(change); continue; }
          row.parentId = null;
        }
        write(entity, row);
      }
      return waiting;
    },
    async keepLocalCopy(entity, _id, record) {
      const row = record as Row;
      const copy = { ...row, id: `${row.id}-copy-${name}`, title: `${row.title} (copy)` };
      write(entity as Entity, copy);
      copies.push(copy.id);
    },
    settings: { keys: ["stages"], changed: () => {} },
  };
  return { tables, write, remove, adapter, kv, settings, copies, book: createMemorySyncBook() };
}

function connect(device: ReturnType<typeof createDevice>, server: ReturnType<typeof createServer>, deviceId: string) {
  const state: SyncState = { userId: "u", email: "u@x", keyId: CLOUD_FORMAT, deviceId, pushed: 0, pulled: 0, lastSyncedAt: null };
  return createSyncEngine({ app: "test", adapter: device.adapter, transport: server.transport(), book: device.book, kv: device.kv, state });
}

describe("sync engine", () => {
  it("brings records to another device and never echoes them back", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("parents", { id: "p1", title: "Folder" });
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    a.settings.set("stages", "[1,2]");
    const syncA = connect(a, server, "A");
    const syncB = connect(b, server, "B");
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
    const syncA = connect(a, server, "A");
    const syncB = connect(b, server, "B");
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
    const syncA = connect(a, server, "A");
    const syncB = connect(b, server, "B");
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
    const syncA = connect(a, server, "A");
    const syncB = connect(b, server, "B");
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
    const syncA = connect(a, server, "A");
    const syncB = connect(b, server, "B");
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
    const syncA = connect(a, server, "A");
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
    const syncB = connect(fresh, server, "B");
    await syncB.sync();
    expect(fresh.tables.children.get("c1")?.parentId).toBe("p1");
    expect(fresh.tables.parents.get("p1")?.title).toBe("Renamed");
    void b;
  });

  it("keeps paging while a child waits for a parent several pages later", async () => {
    const server = createServer();
    const a = createDevice("a");
    const syncA = connect(a, server, "A");
    a.write("parents", { id: "p1", title: "Folder" });
    await syncA.sync();
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    for (let i = 0; i < 6; i++) a.write("children", { id: `x${i}`, title: "filler" });
    await syncA.sync();
    // The parent's newest revision now lies three pages behind its child.
    a.write("parents", { id: "p1", title: "Renamed" });
    await syncA.sync();
    const b = createDevice("b");
    const syncB = connect(b, server, "B");
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
    await connect(a, server, "A").sync();
    const stored = [...server.records.values()][0];
    expect(stored.data).toBeUndefined();
    expect(stored.blobUrl).toBeTruthy();
    await connect(b, server, "B").sync();
    expect(b.tables.children.get("c1")?.title).toBe(big);
  });

  it("skips end-to-end encrypted records of older app versions", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    server.addEncrypted();
    a.write("children", { id: "c1", title: "Script" });
    await connect(a, server, "A").sync();
    const syncB = connect(b, server, "B");
    await syncB.sync();
    expect([...b.tables.children.keys()]).toEqual(["c1"]);
    expect(syncB.state.pulled).toBe(2);
  });
});
