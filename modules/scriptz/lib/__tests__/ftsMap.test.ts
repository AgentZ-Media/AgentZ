// @vitest-environment node
// The search index rowid map (migration 013) against real SQLite and every
// migration the desktop host installs: duplicates from before the map are
// cleaned up, saves replace exactly one row per script, deletes and the
// emptied trash leave no index rows behind.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformAdapter, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { deleteScriptFts, upsertScriptFts } from "../fts";
import { globalSearch } from "../search";
import { emptyTrash } from "../scripts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const migrations = new URL("../../../../apps/scriptz/src-tauri/migrations/", import.meta.url);

let db: SQLiteDatabase;
const original = (() => {
  try {
    return getPlatformAdapter();
  } catch {
    return null;
  }
})();

const bind = (values: unknown[]) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v as SQLInputValue]));

/** Applies the published migrations `from`..`to`, in install order. */
function migrate(from: number, to: number) {
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    const version = Number(file.slice(0, 3));
    if (version >= from && version <= to) db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
}

function addScript(id: string, archived = false) {
  db.prepare(
    `INSERT INTO scripts (id, title, content_json, created_at, updated_at, archived_at)
     VALUES (?, ?, '{}', 1, 1, ?)`,
  ).run(id, id, archived ? 2 : null);
}

const ftsRows = (id: string) =>
  (db.prepare("SELECT count(*) AS n FROM scripts_fts WHERE script_id = ?").get(id) as { n: number }).n;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  setPlatformAdapter({ getDb: async (): Promise<DbConnection> => ({
    select: async <T>(sql: string, values: unknown[] = []): Promise<T> =>
      (values.length ? db.prepare(sql).all(bind(values)) : db.prepare(sql).all()) as T,
    execute: async (sql: string, values: unknown[] = []) => {
      const result = values.length ? db.prepare(sql).run(bind(values)) : db.prepare(sql).run();
      return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
    },
  }) } as PlatformAdapter);
});
afterEach(() => {
  db.close();
  if (original) setPlatformAdapter(original);
});

describe("search index rowid map", () => {
  it("maps existing rows and drops duplicates during the migration", () => {
    migrate(1, 12);
    addScript("a");
    addScript("b");
    const insert = db.prepare("INSERT INTO scripts_fts (script_id, title, content_text) VALUES (?, ?, ?)");
    insert.run("a", "A", "stale");
    insert.run("b", "B", "second");
    insert.run("a", "A", "newest");
    migrate(13, 13);
    expect(ftsRows("a")).toBe(1);
    // The last written duplicate is the current text.
    expect(db.prepare("SELECT content_text FROM scripts_fts WHERE script_id = 'a'").get()).toEqual({ content_text: "newest" });
    expect(db.prepare("SELECT script_id FROM scripts_fts_map ORDER BY script_id").all()).toEqual([
      { script_id: "a" },
      { script_id: "b" },
    ]);
  });

  it("keeps one row per script across saves and finds the newest text", async () => {
    migrate(1, 13);
    addScript("a");
    await upsertScriptFts("a", "Alpha", "rain falls");
    // Two writers of the same script (rename and autosave) at once.
    await Promise.all([upsertScriptFts("a", "Alpha", "wind blows"), upsertScriptFts("a", "Alpha", "sun shines")]);
    expect(ftsRows("a")).toBe(1);
    expect((await globalSearch("sun")).map((h) => h.id)).toEqual(["a"]);
    expect(await globalSearch("rain")).toEqual([]);
  });

  it("removes index rows and map entries on delete and on emptying the trash", async () => {
    migrate(1, 13);
    addScript("a");
    addScript("b", true);
    addScript("c");
    await upsertScriptFts("a", "A", "one");
    await upsertScriptFts("b", "B", "two");
    await upsertScriptFts("c", "C", "three");
    await deleteScriptFts("a");
    await emptyTrash();
    expect(ftsRows("a")).toBe(0);
    expect(ftsRows("b")).toBe(0);
    expect(ftsRows("c")).toBe(1);
    expect(db.prepare("SELECT script_id FROM scripts_fts_map").all()).toEqual([{ script_id: "c" }]);
  });
});
