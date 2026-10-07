// @vitest-environment node
// Real SQLite, including the exact migrations installed by the desktop host.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { setPlatformAdapter, type PlatformAdapter, type DbConnection } from "@agentz/kit/platform";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTENT_ENTITIES, type ContentEntity } from "../localChanges/entities";
import { sqlLocalChanges } from "../localChanges/sql";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

const migrations = new URL("../../../../apps/scriptz/src-tauri/migrations/", import.meta.url);
const migration009 = readFileSync(new URL("009_local_changes.sql", migrations), "utf8");
const migration010 = readFileSync(new URL("010_agent_sessions.sql", migrations), "utf8");
const migration011 = readFileSync(new URL("011_track_agent_sessions.sql", migrations), "utf8");
const migration012 = readFileSync(new URL("012_agent_learned_text.sql", migrations), "utf8");
const migration013 = readFileSync(new URL("013_large_library_indexes.sql", migrations), "utf8");
const migration014 = readFileSync(new URL("014_cloud_sync.sql", migrations), "utf8");
let db: SQLiteDatabase;
let tempDir: string;
let dbPath: string;

/** Builds the published pre-tracking schema with foreign-key behavior enabled. */
function migrateLegacy() {
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => /^00[1-8]_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
}

/** Applies change tracking and every later migration, in install order. */
function migrateTracking() {
  db.exec(migration009);
  db.exec(migration010);
  db.exec(migration011);
  db.exec(migration012);
  db.exec(migration013);
  db.exec(migration014);
}

/** Seeds each tracked content type plus settings and UI state excluded from the feed. */
function seedContent() {
  db.exec(`
    INSERT INTO folders VALUES ('folder', 'Ideas', 1, 2, 15, 60);
    INSERT INTO scripts (id, title, content_json, characters_meta, created_at, updated_at, folder_id)
      VALUES ('script', 'Scene', '{"root":{"children":[]}}', '[{"name":"TIMO","color":"#e0791f"}]', 1, 2, 'folder');
    INSERT INTO ideas (id, title, notes, created_at, script_id, folder_id) VALUES ('idea', 'Idea', 'Note', 1, 'script', 'folder');
    INSERT INTO snapshots VALUES ('snapshot', 'script', '{"root":{}}', 'manual', 3);
    INSERT INTO character_colors VALUES ('Timo', '#e0791f', NULL, 1);
    INSERT INTO agent_chats (id, script_id, provider, thread_id, items_json, created_at, updated_at)
      VALUES ('chat', 'script', 'codex', 'local-thread', '[{"kind":"user","id":"message","text":"Hello"}]', 1, 2);
    INSERT INTO agent_memory VALUES ('memory', 'character', 'folder', 'TIMO', 'Profile', 'user', 'script', 1, 2);
    INSERT INTO agent_learned (script_id, content_hash, learned_at) VALUES ('script', 'hash', 4);
    INSERT INTO daily_word_log VALUES ('2026-10-05', 42);
    INSERT INTO settings VALUES ('language', 'de');
    INSERT INTO app_state VALUES ('nav.state', '{"route":"scripts"}');
  `);
}

/** Captures all durable content rows to detect unintended migration rewrites. */
function contentSnapshot() {
  return Object.keys(CONTENT_ENTITIES).map((table) => db.prepare(`SELECT * FROM ${table}`).all());
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "scriptz-local-changes-"));
  dbPath = join(tempDir, "test.db");
  db = new DatabaseSync(dbPath);
  setPlatformAdapter({ getDb: async (): Promise<DbConnection> => ({
    select: async <T>(sql: string, values: unknown[] = []): Promise<T> => {
      const stmt = db.prepare(sql);
      return (values.length
        ? stmt.all(Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v as SQLInputValue])))
        : stmt.all()) as T;
    },
    execute: async () => { throw new Error("Read-only feed must not write"); },
  }) } as PlatformAdapter);
  migrateLegacy();
});
afterEach(() => {
  db.close();

  rmSync(tempDir, { recursive: true, force: true });
});

describe("local content change feed", () => {
  it("seeds existing user content without rewriting it or settings", async () => {
    seedContent();
    const before = contentSnapshot();
    db.exec(migration009);
    expect(contentSnapshot()).toEqual(before);
    db.exec(migration010);
    db.exec(migration011);
    db.exec(migration012);
    // 012 only adds a column: the learned marker keeps its values.
    expect(db.prepare("SELECT * FROM agent_learned").all()).toEqual([{ script_id: "script", content_hash: "hash", learned_at: 4, learned_text: null }]);
    expect(db.prepare("SELECT * FROM settings").all()).toEqual([{ key: "language", value: "de" }]);
    expect(db.prepare("SELECT * FROM app_state").all()).toEqual([{ key: "nav.state", value: '{"route":"scripts"}' }]);
    const page = await sqlLocalChanges.readChanges();
    expect(page.replicaId).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(page.changes).toHaveLength(9);
    expect(page.formatVersion).toBe(1);
    for (const change of page.changes) {
      expect(change.operation).toBe("upsert");
      expect(Object.keys(change.record!).sort()).toEqual([...CONTENT_ENTITIES[change.entity].columns].sort());
      expect(change.changeId).toBe(`${page.replicaId}:${change.sequence}`);
    }
    expect(await sqlLocalChanges.readChanges()).toEqual(page);
  });

  it("covers every durable content table and every column in the actual schema", () => {
    migrateTracking();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'scripts_fts%' AND name NOT IN ('settings','app_state','local_replica','local_changes','sqlite_sequence','sync_records','daily_word_log_remote')").all().map((r) => r.name);
    expect(tables.sort()).toEqual(Object.keys(CONTENT_ENTITIES).sort());
    for (const [table, config] of Object.entries(CONTENT_ENTITIES)) {
      expect(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name).sort()).toEqual([...config.columns].sort());
    }
    // The desktop host registers every migration file under its number.
    const host = readFileSync(new URL("../src/lib.rs", migrations), "utf8");
    for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql"))) {
      const version = Number(file.slice(0, 3));
      const constant = `MIGRATION_${file.replace(/\.sql$/, "").toUpperCase()}`;
      expect(host).toContain(`include_str!("../migrations/${file}")`);
      expect(host).toMatch(new RegExp(`version: ${version},[\\s\\S]*?sql: ${constant},`));
    }
  });

  it("fires an update marker for a change in any column of every content table", () => {
    // A column missing from a trigger would silently never sync. New columns
    // need the trigger recreated (see 011) and CONTENT_ENTITIES extended.
    migrateTracking();
    for (const [table, config] of Object.entries(CONTENT_ENTITIES)) {
      const trigger = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(`track_${table}_update`);
      expect(trigger, table).toBeDefined();
      for (const column of config.columns) {
        expect(String(trigger!.sql), `${table}.${column}`).toMatch(new RegExp(`OLD\\.${column}( COLLATE BINARY)? IS NOT NEW\\.${column}\\b`));
      }
    }
  });

  it("ends with the same tracking when a development database applied 010 before 009", async () => {
    seedContent();
    db.exec(migration010);
    db.exec("UPDATE agent_chats SET kind = 'session', title = 'Session', script_id = NULL");
    db.exec(migration009);
    db.exec(migration011);
    db.exec(migration012);
    const triggers = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    const devOrder = triggers();
    const seeded = await sqlLocalChanges.readChanges();
    expect(seeded.changes).toHaveLength(9);
    expect(seeded.changes.find((c) => c.entity === "agent_chats")?.record).toMatchObject({ kind: "session", title: "Session" });
    db.close();
    db = new DatabaseSync(join(tempDir, "fresh.db"));
    migrateLegacy();
    migrateTracking();
    expect(devOrder).toEqual(triggers());
  });

  it("tracks agent-mode sessions and the origin of saved ideas", async () => {
    seedContent();
    migrateTracking();
    const start = (await sqlLocalChanges.readChanges()).nextCursor;
    const changed = async (after: number) => (await sqlLocalChanges.readChanges({ afterSequence: after })).changes;
    db.exec("UPDATE agent_chats SET title = 'Named'");
    expect((await changed(start)).map((c) => c.entity)).toEqual(["agent_chats"]);
    let cursor = (await sqlLocalChanges.readChanges()).nextCursor;
    db.exec("UPDATE agent_chats SET folder_id = 'folder'");
    db.exec("UPDATE agent_chats SET kind = 'session'");
    expect((await changed(cursor)).find((c) => c.entity === "agent_chats")?.record).toMatchObject({ kind: "session", folder_id: "folder", title: "Named" });
    db.exec("UPDATE ideas SET source_chat_id = 'chat'");
    cursor = (await sqlLocalChanges.readChanges()).nextCursor;
    // Purging the script frees the session (010) instead of deleting it.
    db.exec("DELETE FROM scripts WHERE id = 'script'");
    const purge = await changed(cursor);
    expect(purge.find((c) => c.entity === "agent_chats")).toMatchObject({ operation: "upsert", record: { script_id: null } });
    cursor = (await sqlLocalChanges.readChanges()).nextCursor;
    // Deleting the session keeps its ideas and records the cleared origin.
    db.exec("DELETE FROM agent_chats WHERE id = 'chat'");
    const removal = await changed(cursor);
    expect(removal.find((c) => c.entity === "agent_chats")).toMatchObject({ operation: "delete", record: null });
    expect(removal.find((c) => c.entity === "ideas")?.record).toMatchObject({ source_chat_id: null });
  });

  it("keeps an empty fresh install usable and tracks later inserts", async () => {
    migrateTracking();
    const empty = await sqlLocalChanges.readChanges();
    expect(empty.changes).toEqual([]);
    expect(empty.nextCursor).toBe(0);
    seedContent();
    expect((await sqlLocalChanges.readChanges()).changes).toHaveLength(9);
    expect(await sqlLocalChanges.getReplicaId()).toBe(empty.replicaId);
  });

  it("tracks each content type but never settings, UI state or the search index", async () => {
    seedContent();
    migrateTracking();
    const initial = await sqlLocalChanges.readChanges();
    db.exec(`
      UPDATE scripts SET status = 'ready' WHERE id = 'script';
      UPDATE folders SET name = 'Renamed';
      UPDATE ideas SET notes = 'More notes';
      UPDATE snapshots SET content_json = '{"snapshot":true}';
      UPDATE character_colors SET override_color = '#123456';
      UPDATE agent_chats SET items_json = '[]';
      UPDATE agent_memory SET content = 'New profile';
      UPDATE agent_learned SET content_hash = 'new hash';
      UPDATE daily_word_log SET words_added = 43;
      UPDATE settings SET value = 'en';
      UPDATE app_state SET value = '{}';
      INSERT INTO scripts_fts (script_id, title, content_text) VALUES ('script', 'Scene', 'Text');
    `);
    const page = await sqlLocalChanges.readChanges({ afterSequence: initial.nextCursor });
    expect(page.changes.map((c) => c.entity).sort()).toEqual(Object.keys(CONTENT_ENTITIES).sort());
    expect(page.changes.find((c) => c.entity === "scripts")?.record).toMatchObject({ status: "ready", updated_at: 2 });
    const checkpoint = page.nextCursor;
    db.exec("UPDATE settings SET value = 'fr'; UPDATE app_state SET value = '[]'; DELETE FROM scripts_fts");
    expect((await sqlLocalChanges.readChanges({ afterSequence: checkpoint })).changes).toEqual([]);
  });

  it("coalesces autosaves without copying content or counting unchanged writes", async () => {
    seedContent();
    migrateTracking();
    const before = await sqlLocalChanges.readChanges();
    const stmt = db.prepare("UPDATE scripts SET title = ? WHERE id = 'script'");
    for (let n = 0; n < 500; n++) stmt.run(`Edit ${n}`);
    const page = await sqlLocalChanges.readChanges({ afterSequence: before.nextCursor });
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].record).toMatchObject({ title: "Edit 499" });
    expect(db.prepare("SELECT count(*) AS n FROM local_changes").get()?.n).toBe(9);
    db.exec("UPDATE scripts SET title = title; UPDATE character_colors SET updated_at = updated_at");
    expect(await sqlLocalChanges.readChanges({ afterSequence: before.nextCursor })).toEqual(page);
  });

  it("retains pending changes, identity and deletion tombstones across restart", async () => {
    seedContent();
    migrateTracking();
    const cursor = (await sqlLocalChanges.readChanges()).nextCursor;
    db.exec("DELETE FROM scripts WHERE id = 'script'");
    const page = await sqlLocalChanges.readChanges({ afterSequence: cursor });
    expect(page.changes.filter((c) => c.operation === "delete").map((c) => c.entity).sort()).toEqual(["agent_chats", "agent_learned", "scripts", "snapshots"]);
    expect(page.changes.find((c) => c.entity === "ideas")?.record).toMatchObject({ script_id: null });
    expect(page.changes.filter((c) => c.operation === "delete").every((c) => c.record === null)).toBe(true);
    db.close();
    db = new DatabaseSync(dbPath);

    expect(await sqlLocalChanges.readChanges({ afterSequence: cursor })).toEqual(page);
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  });

  it("captures cascaded memory deletion and idea folder unlinking", async () => {
    seedContent();
    migrateTracking();
    // Matches the existing folder delete workflow.
    db.exec("UPDATE scripts SET folder_id = NULL; DELETE FROM folders WHERE id = 'folder'");
    const page = await sqlLocalChanges.readChanges();
    expect(page.changes.find((c) => c.entity === "agent_memory")).toMatchObject({ operation: "delete", record: null });
    expect(page.changes.find((c) => c.entity === "ideas")?.record).toMatchObject({ folder_id: null });
  });

  it("rolls back a content statement if its change marker cannot be written", async () => {
    seedContent();
    migrateTracking();
    const before = await sqlLocalChanges.readChanges();
    db.exec("CREATE TRIGGER fail_marker BEFORE INSERT ON local_changes BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => db.exec("UPDATE scripts SET title = 'Must not persist'")).toThrow("test failure");
    expect(db.prepare("SELECT title FROM scripts").get()?.title).toBe("Scene");
    expect(await sqlLocalChanges.readChanges()).toEqual(before);
  });

  it("rolls back content, cascades and sequence changes together", async () => {
    seedContent();
    migrateTracking();
    const before = await sqlLocalChanges.readChanges();
    db.exec("BEGIN; DELETE FROM scripts; UPDATE character_colors SET override_color = '#ffffff'; ROLLBACK");
    expect(await sqlLocalChanges.readChanges()).toEqual(before);
  });

  it("reads bounded pages and finds edits made after a page was read", async () => {
    seedContent();
    migrateTracking();
    const first = await sqlLocalChanges.readChanges({ limit: 2 });
    expect(first.changes).toHaveLength(2);
    const changedEntity = first.changes[0].entity;
    db.exec(`UPDATE ${changedEntity} SET title = 'Later' WHERE id = 'script'`);
    let cursor = first.nextCursor;
    const later = [];
    for (;;) {
      const page = await sqlLocalChanges.readChanges({ afterSequence: cursor, limit: 2 });
      expect(page.changes.length).toBeLessThanOrEqual(2);
      if (!page.changes.length) {
        expect(page.nextCursor).toBe(cursor);
        break;
      }
      later.push(...page.changes);
      cursor = page.nextCursor;
    }
    const newest = later.find((c) => c.entity === changedEntity);
    expect(newest?.sequence).toBeGreaterThan(first.changes[0].sequence);
    expect(newest?.record).toMatchObject({ title: "Later" });
    expect(first.changes[0].record).toMatchObject({ title: "Scene" });
  });

  it("preserves case-insensitive color identity and tracks replace-based memory undo", async () => {
    seedContent();
    migrateTracking();
    db.exec(`INSERT INTO character_colors (name, override_color, updated_at) VALUES ('TIMO', '#aabbcc', 3)
      ON CONFLICT(name) DO UPDATE SET override_color = excluded.override_color, updated_at = excluded.updated_at`);
    let page = await sqlLocalChanges.readChanges();
    expect(page.changes.filter((c) => c.entity === "character_colors")).toHaveLength(1);
    expect(page.changes.find((c) => c.entity === "character_colors")).toMatchObject({ entityId: "TIMO", record: { name: "Timo", override_color: "#aabbcc" } });
    const original = db.prepare("SELECT * FROM agent_memory").get()!;
    db.exec("DELETE FROM agent_memory");
    const deletion = (await sqlLocalChanges.readChanges()).changes.find((c) => c.entity === "agent_memory")!;
    db.prepare("INSERT OR REPLACE INTO agent_memory VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...Object.values(original));
    page = await sqlLocalChanges.readChanges({ afterSequence: deletion.sequence });
    expect(page.changes.find((c) => c.entity === "agent_memory")).toMatchObject({ operation: "upsert", record: original });
  });

  it("tracks case-only color name edits without creating a second identity", async () => {
    seedContent();
    migrateTracking();
    const before = await sqlLocalChanges.readChanges();
    db.exec("UPDATE character_colors SET name = 'TIMO' WHERE name = 'Timo'");
    const page = await sqlLocalChanges.readChanges({ afterSequence: before.nextCursor });
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]).toMatchObject({
      entity: "character_colors", entityId: "TIMO", operation: "upsert", record: { name: "TIMO" },
    });
    expect(page.changes[0].sequence).toBeGreaterThan(before.nextCursor);
    expect(db.prepare("SELECT count(*) AS n FROM local_changes WHERE entity = 'character_colors'").get()?.n).toBe(1);
  });

  it("records a changed primary key as old deletion plus new content", async () => {
    seedContent();
    migrateTracking();
    db.exec("UPDATE ideas SET id = 'renamed' WHERE id = 'idea'");
    const page = await sqlLocalChanges.readChanges();
    expect(page.changes.filter((c) => c.entity === "ideas")).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "idea", operation: "delete", record: null }),
      expect.objectContaining({ entityId: "renamed", operation: "upsert", record: expect.objectContaining({ id: "renamed" }) }),
    ]));
  });

  it.each(Object.keys(CONTENT_ENTITIES) as ContentEntity[])("retains tombstones for %s", async (entity) => {
    seedContent();
    migrateTracking();
    if (entity === "folders") db.exec("UPDATE scripts SET folder_id = NULL");
    db.exec(`DELETE FROM ${entity}`);
    const changes = (await sqlLocalChanges.readChanges()).changes.filter((c) => c.entity === entity);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ operation: "delete", record: null });
  });

  it("rejects invalid cursors and oversized pages", async () => {
    migrateTracking();
    for (const afterSequence of [-1, 0.1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(sqlLocalChanges.readChanges({ afterSequence })).rejects.toThrow("cursor");
    }
    for (const limit of [0, -1, 1.5, 1001, Infinity]) {
      await expect(sqlLocalChanges.readChanges({ limit })).rejects.toThrow("page size");
    }
  });
});
