// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KvStore } from "../../platform";
import { createMemorySyncBook, type SyncState } from "../book";
import { createDataKey, createRecordCipher, type DataKey } from "../crypto";
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
    transport(keyId: string): CloudTransport {
      return {
        head: async () => ({ rev: head, keyId, resetting: false }),
        watchHead: () => () => {},
        async pull(_app, afterRev) {
          const list = [...records.values()].filter((r) => r.rev > afterRev).sort((a, b) => a.rev - b.rev);
          const page = list.slice(0, 2);
          return { records: page.map((r) => ({ ...r })), headRev: head, more: list.length > page.length };
        },
        async push(_app, pushKey, deviceId, changes) {
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
              blobUrl: change.blob ? `blob:${change.blob}` : undefined, keyId: pushKey, deviceId,
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
        getKey: async () => null,
        createKey: async () => {},
        rewrapKey: async () => {},
        resetKey: async () => {},
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

async function connect(device: ReturnType<typeof createDevice>, server: ReturnType<typeof createServer>, dataKey: DataKey, deviceId: string) {
  const cipher = await createRecordCipher(dataKey, "test");
  const state: SyncState = { userId: "u", email: "u@x", keyId: dataKey.keyId, deviceId, pushed: 0, pulled: 0, lastSyncedAt: null };
  return createSyncEngine({ app: "test", adapter: device.adapter, cipher, transport: server.transport(dataKey.keyId), book: device.book, kv: device.kv, state });
}

describe("sync engine", () => {
  it("brings records to another device and never echoes them back", async () => {
    const server = createServer();
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("parents", { id: "p1", title: "Folder" });
    a.write("children", { id: "c1", title: "Script", parentId: "p1" });
    a.settings.set("stages", "[1,2]");
    const syncA = await connect(a, server, key, "A");
    const syncB = await connect(b, server, key, "B");
    await syncA.sync();
    expect(server.records.size).toBe(3);
    await syncB.sync();
    expect(b.tables.children.get("c1")).toEqual({ id: "c1", title: "Script", parentId: "p1" });
    expect(b.settings.get("stages")).toBe("[1,2]");
    const before = server.pushes.length;
    await syncB.sync();
    await syncA.sync();
    expect(server.pushes.length).toBe(before);
    // The server never sees content or local IDs.
    for (const record of server.records.values()) {
      expect(new TextDecoder().decode(new Uint8Array(record.data!))).not.toContain("Script");
      expect(record.recordId).not.toContain("c1");
    }
  });

  it("keeps the cloud version and the local one as a copy when both changed", async () => {
    const server = createServer();
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, key, "A");
    const syncB = await connect(b, server, key, "B");
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
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, key, "A");
    const syncB = await connect(b, server, key, "B");
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
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    const syncA = await connect(a, server, key, "A");
    const syncB = await connect(b, server, key, "B");
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
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "v1" });
    a.write("children", { id: "tmp", title: "temp" });
    a.remove("children", "tmp");
    const syncA = await connect(a, server, key, "A");
    const syncB = await connect(b, server, key, "B");
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
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    const syncA = await connect(a, server, key, "A");
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
    const syncB = await connect(fresh, server, key, "B");
    await syncB.sync();
    expect(fresh.tables.children.get("c1")?.parentId).toBe("p1");
    expect(fresh.tables.parents.get("p1")?.title).toBe("Renamed");
    void b;
  });

  it("moves large records through file storage", async () => {
    const server = createServer();
    const key = createDataKey();
    const a = createDevice("a");
    const b = createDevice("b");
    // Random text does not compress below the inline limit.
    const big = Array.from({ length: INLINE_LIMIT / 2 }, () => Math.random().toString(36).slice(2, 8)).join("");
    a.write("children", { id: "c1", title: big });
    await (await connect(a, server, key, "A")).sync();
    const stored = [...server.records.values()][0];
    expect(stored.data).toBeUndefined();
    expect(stored.blobUrl).toBeTruthy();
    await (await connect(b, server, key, "B")).sync();
    expect(b.tables.children.get("c1")?.title).toBe(big);
  });

  it("ignores records encrypted with another key", async () => {
    const server = createServer();
    const a = createDevice("a");
    const b = createDevice("b");
    a.write("children", { id: "c1", title: "secret" });
    await (await connect(a, server, createDataKey(), "A")).sync();
    await (await connect(b, server, createDataKey(), "B")).sync();
    expect(b.tables.children.size).toBe(0);
  });
});
