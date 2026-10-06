// @vitest-environment jsdom
// Two real SQLite databases with every migration, synced through a fake cloud
// with the semantics of apps/site/convex/sync.ts.
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import {
  createDataKey, createMemorySyncBook, createRecordCipher, createSyncEngine,
  type CloudTransport, type PushResult, type SyncState, type WireRecord,
} from "@agentz/kit/account";
import { createSqlKvStore, setKvStore, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { createScriptzSyncAdapter, type AppliedSummary } from "../adapter";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
// jsdom (the Kit account UI needs a DOM to import) has no file URLs; tests run in the package root.
const migrations = join(process.cwd(), "../../apps/scriptz/src-tauri/migrations");

function openDatabase(): SQLiteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(migrations, file), "utf8"));
  }
  return db;
}

function connection(db: SQLiteDatabase): DbConnection {
  const bind = (values: unknown[]) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v as SQLInputValue]));
  return {
    select: async <T,>(sql: string, values: unknown[] = []) => (values.length ? db.prepare(sql).all(bind(values)) : db.prepare(sql).all()) as T,
    execute: async (sql: string, values: unknown[] = []) => {
      const result = values.length ? db.prepare(sql).run(bind(values)) : db.prepare(sql).run();
      return { rowsAffected: Number(result.changes) };
    },
  };
}

function createServer() {
  let head = 0;
  const records = new Map<string, WireRecord>();
  let pushes = 0;
  const transport = (keyId: string): CloudTransport => ({
    head: async () => ({ rev: head, keyId, resetting: false }),
    watchHead: () => () => {},
    async pull(_app, afterRev) {
      const list = [...records.values()].filter((r) => r.rev > afterRev).sort((a, b) => a.rev - b.rev);
      return { records: list.slice(0, 3), headRev: head, more: list.length > 3 };
    },
    async push(_app, pushKey, deviceId, changes) {
      const results: PushResult[] = [];
      for (const change of changes) {
        pushes += 1;
        const existing = records.get(change.recordId);
        const current = existing?.rev ?? 0;
        if (change.baseRev !== current) {
          results.push(existing?.deleted && change.deleted
            ? { recordId: change.recordId, status: "ok", rev: current }
            : { recordId: change.recordId, status: "conflict", rev: current, current: existing ?? null });
          continue;
        }
        head += 1;
        records.set(change.recordId, { recordId: change.recordId, rev: head, deleted: change.deleted, data: change.data, keyId: pushKey, deviceId });
        results.push({ recordId: change.recordId, status: "ok", rev: head });
      }
      return { results, headRev: head };
    },
    upload: async () => { throw new Error("not used"); },
    download: async () => { throw new Error("not used"); },
    getKey: async () => null,
    createKey: async () => {},
    rewrapKey: async () => {},
    resetKey: async () => {},
    connected: () => true,
    close: () => {},
  });
  return { transport, pushes: () => pushes };
}

const dbs: SQLiteDatabase[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

async function device(name: string, server: ReturnType<typeof createServer>, key = sharedKey) {
  const db = openDatabase();
  dbs.push(db);
  const conn = connection(db);
  const platform = { getDb: async () => conn } as unknown as PlatformAdapter;
  const kv = createSqlKvStore(async () => conn);
  const activate = () => { setPlatformAdapter(platform); setKvStore(kv); };
  const applied: AppliedSummary[] = [];
  const adapter = createScriptzSyncAdapter({ applied: (summary) => applied.push(summary), settingsChanged: () => {}, copySuffix: () => "Konfliktkopie" });
  const state: SyncState = { userId: "u", email: "u@x", keyId: key.keyId, deviceId: name, pushed: 0, pulled: 0, lastSyncedAt: null };
  const engine = createSyncEngine({
    app: "scriptz", adapter, cipher: await createRecordCipher(key, "scriptz"),
    transport: server.transport(key.keyId), book: createMemorySyncBook(), kv, state,
  });
  return {
    db, applied,
    run(sql: string) { db.exec(sql); },
    rows: (sql: string) => db.prepare(sql).all(),
    async sync() { activate(); await engine.sync(); },
  };
}
let sharedKey = createDataKey();

const SEED = `
  INSERT INTO folders VALUES ('folder', 'Sketche', 1, 2, 15, 60);
  INSERT INTO scripts (id, title, content_json, characters_meta, created_at, updated_at, folder_id, status)
    VALUES ('script', 'Szene', '{"root":{"children":[{"type":"scriptz-action","children":[{"type":"text","text":"Timo winkt."}]}]}}', '[{"name":"TIMO","color":"#e0791f"}]', 1, 2, 'folder', 'writing');
  INSERT INTO ideas (id, title, notes, created_at, script_id, folder_id) VALUES ('idea', 'Idee', 'Notiz', 1, 'script', 'folder');
  INSERT INTO snapshots VALUES ('snapshot', 'script', '{"root":{}}', 'manual', 3);
  INSERT INTO character_colors VALUES ('Timo', '#e0791f', NULL, 1);
  INSERT INTO agent_chats (id, script_id, provider, thread_id, items_json, created_at, updated_at)
    VALUES ('chat', 'script', 'codex', 'local-thread', '[{"kind":"user","id":"m","text":"Hallo"}]', 1, 2);
  INSERT INTO agent_memory VALUES ('memory', 'folder', 'folder', NULL, 'Kurz halten', 'user', NULL, 1, 2);
  INSERT INTO agent_learned (script_id, content_hash, learned_at, learned_text) VALUES ('script', 'hash', 4, 'Text');
  INSERT INTO daily_word_log VALUES ('2026-10-05', 42);
  INSERT INTO settings VALUES ('dialog_wpm', '180');
  INSERT INTO settings VALUES ('dark_paper', '1');
`;

describe("ScriptZ sync adapter", () => {
  it("copies every kind of content to a second device and keeps device-local details local", async () => {
    sharedKey = createDataKey();
    const server = createServer();
    const a = await device("A", server);
    const b = await device("B", server);
    a.run(SEED);
    await a.sync();
    await b.sync();
    for (const table of ["folders", "scripts", "ideas", "snapshots", "character_colors", "agent_memory", "agent_learned"]) {
      expect(b.rows(`SELECT * FROM ${table}`), table).toEqual(a.rows(`SELECT * FROM ${table}`));
    }
    // The Codex thread exists only on device A.
    expect(b.rows("SELECT id, thread_id, items_json FROM agent_chats")).toEqual([{ id: "chat", thread_id: null, items_json: '[{"kind":"user","id":"m","text":"Hallo"}]' }]);
    // Words of device A count on B, in a table of their own.
    expect(b.rows("SELECT * FROM daily_word_log")).toEqual([]);
    expect(b.rows("SELECT * FROM daily_word_log_remote")).toEqual([{ device_id: "A", date: "2026-10-05", words_added: 42 }]);
    // Search finds the synced script.
    expect(b.rows("SELECT script_id FROM scripts_fts WHERE scripts_fts MATCH 'winkt'")).toEqual([{ script_id: "script" }]);
    // Synced settings only: appearance stays per device.
    expect(b.rows("SELECT key, value FROM settings ORDER BY key")).toEqual([{ key: "dialog_wpm", value: "180" }]);
    expect(b.applied.some((summary) => summary.scripts.has("script"))).toBe(true);

    const pushes = server.pushes();
    await b.sync();
    await a.sync();
    expect(server.pushes()).toBe(pushes);
  });

  it("keeps the local thread while a chat did not change and drops it when it did", async () => {
    sharedKey = createDataKey();
    const server = createServer();
    const a = await device("A", server);
    const b = await device("B", server);
    a.run(SEED);
    await a.sync();
    await b.sync();
    b.run("UPDATE agent_chats SET thread_id = 'thread-b' WHERE id = 'chat'");
    a.run("UPDATE agent_chats SET title = 'Neu' WHERE id = 'chat'");
    await a.sync();
    await b.sync();
    expect(b.rows("SELECT title, thread_id FROM agent_chats")).toEqual([{ title: "Neu", thread_id: "thread-b" }]);
    a.run(`UPDATE agent_chats SET items_json = '[]' WHERE id = 'chat'`);
    await a.sync();
    await b.sync();
    expect(b.rows("SELECT thread_id FROM agent_chats")).toEqual([{ thread_id: null }]);
  });

  it("keeps a script edited on two devices as a conflict copy", async () => {
    sharedKey = createDataKey();
    const server = createServer();
    const a = await device("A", server);
    const b = await device("B", server);
    a.run(SEED);
    await a.sync();
    await b.sync();
    a.run(`UPDATE scripts SET content_json = '{"root":{"children":[]}}', updated_at = 10 WHERE id = 'script'`);
    b.run(`UPDATE scripts SET title = 'Szene B', updated_at = 11 WHERE id = 'script'`);
    await a.sync();
    await b.sync();
    const titles = b.rows("SELECT title FROM scripts ORDER BY title").map((row) => row.title);
    expect(titles).toEqual(["Szene", "Szene B (Konfliktkopie)"]);
    await a.sync();
    expect(a.rows("SELECT title FROM scripts ORDER BY title").map((row) => row.title)).toEqual(titles);
  });

  it("deletes a script with its snapshots and chats on the other device", async () => {
    sharedKey = createDataKey();
    const server = createServer();
    const a = await device("A", server);
    const b = await device("B", server);
    a.run(SEED);
    await a.sync();
    await b.sync();
    a.run("DELETE FROM scripts WHERE id = 'script'");
    await a.sync();
    await b.sync();
    expect(b.rows("SELECT id FROM scripts")).toEqual([]);
    expect(b.rows("SELECT id FROM snapshots")).toEqual([]);
    expect(b.rows("SELECT script_id FROM ideas")).toEqual([{ script_id: null }]);
  });

  it("leaves the unedited welcome script of each installation out", async () => {
    sharedKey = createDataKey();
    const server = createServer();
    const a = await device("A", server);
    const b = await device("B", server);
    a.run(`INSERT INTO scripts (id, title, content_json, created_at, updated_at) VALUES ('welcome', 'Willkommen', '{"root":{"children":[]}}', 5, 5);
           INSERT INTO app_state VALUES ('welcome_script_id_v1', 'welcome');`);
    await a.sync();
    await b.sync();
    expect(b.rows("SELECT id FROM scripts")).toEqual([]);
    a.run("UPDATE scripts SET updated_at = 6 WHERE id = 'welcome'");
    await a.sync();
    await b.sync();
    expect(b.rows("SELECT id FROM scripts")).toEqual([{ id: "welcome" }]);
  });
});
