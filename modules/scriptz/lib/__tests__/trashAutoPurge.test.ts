// @vitest-environment node
// Automatic trash cleanup against real SQLite and every migration the
// desktop host installs: only entries past the retention period go, their
// snapshots and index rows with them, and the change feed records the
// deletes so sync removes the cloud copies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import type { DatabaseSync as SQLiteDatabase, SQLInputValue } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformAdapter, setPlatformAdapter, type DbConnection, type PlatformAdapter } from "@agentz/kit/platform";
import { upsertScriptFts } from "../fts";
import { purgeExpiredTrash } from "../scripts";
import { getStorageAdapter, setStorageAdapter } from "../storage";
import { registerSqlStorageAdapter } from "../api";
import { scriptsBus } from "../scriptsBus";
import {
  TRASH_PURGE_BOOT_DELAY_MS,
  TRASH_PURGE_INTERVAL_MS,
  TRASH_RETENTION_MS,
  daysUntilPurge,
  runTrashPurge,
  startTrashAutoPurge,
} from "../trashAutoPurge";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const migrations = new URL("../../../../apps/scriptz/src-tauri/migrations/", import.meta.url);
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 7, 12);

let db: SQLiteDatabase;
const originalPlatform = (() => {
  try {
    return getPlatformAdapter();
  } catch {
    return null;
  }
})();
const originalStorage = (() => {
  try {
    return getStorageAdapter();
  } catch {
    return null;
  }
})();

const bind = (values: unknown[]) => Object.fromEntries(values.map((v, i) => [`$${i + 1}`, v as SQLInputValue]));

function migrate() {
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
}

function addScript(id: string, archivedAt: number | null) {
  db.prepare(
    `INSERT INTO scripts (id, title, content_json, created_at, updated_at, archived_at)
     VALUES (?, ?, '{}', 1, 1, ?)`,
  ).run(id, id, archivedAt);
  db.prepare(
    "INSERT INTO snapshots (id, script_id, content_json, trigger, created_at) VALUES (?, ?, '{}', 'manual', 1)",
  ).run(`snap-${id}`, id);
}

const ids = (table: string, column = "id") =>
  (db.prepare(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).all() as { id: string }[]).map((r) => r.id);

const deletes = (entity: string) =>
  (db.prepare(
    "SELECT entity_id AS id FROM local_changes WHERE entity = ? AND operation = 'delete' ORDER BY entity_id",
  ).all(entity) as { id: string }[]).map((r) => r.id);

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
  migrate();
  addScript("live", null);
  addScript("fresh", NOW - 29 * DAY);
  addScript("edge", NOW - 30 * DAY);
  addScript("old", NOW - 90 * DAY);
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
  if (originalPlatform) setPlatformAdapter(originalPlatform);
  if (originalStorage) setStorageAdapter(originalStorage);
});

describe("automatic trash cleanup", () => {
  it("deletes only scripts trashed at or before the cutoff, with snapshots and index rows", async () => {
    for (const id of ["live", "fresh", "edge", "old"]) await upsertScriptFts(id, id, id);
    expect(await purgeExpiredTrash(NOW - TRASH_RETENTION_MS)).toBe(2);
    expect(ids("scripts")).toEqual(["fresh", "live"]);
    expect(ids("snapshots", "script_id")).toEqual(["fresh", "live"]);
    expect(ids("scripts_fts", "script_id")).toEqual(["fresh", "live"]);
    expect(ids("scripts_fts_map", "script_id")).toEqual(["fresh", "live"]);
    // The change feed carries the deletes, so the cloud copies go too.
    expect(deletes("scripts")).toEqual(["edge", "old"]);
    expect(deletes("snapshots")).toEqual(["snap-edge", "snap-old"]);
    expect(await purgeExpiredTrash(NOW - TRASH_RETENTION_MS)).toBe(0);
  });

  it("keeps a script restored between the lookup and its delete", async () => {
    const original = getPlatformAdapter();
    setPlatformAdapter({
      getDb: async () => {
        const conn = await original.getDb();
        return {
          ...conn,
          select: async <T>(sql: string, values?: unknown[]): Promise<T> => {
            const rows = await conn.select<T>(sql, values);
            if (sql.includes("archived_at <=")) db.prepare("UPDATE scripts SET archived_at = NULL WHERE id = 'old'").run();
            return rows;
          },
        };
      },
    } as PlatformAdapter);
    expect(await purgeExpiredTrash(NOW - TRASH_RETENTION_MS)).toBe(1);
    expect(ids("scripts")).toEqual(["fresh", "live", "old"]);
  });

  it("runs after boot and hourly through the storage adapter", async () => {
    vi.useFakeTimers({ now: NOW });
    registerSqlStorageAdapter();
    const before = scriptsBus.version();
    const stop = startTrashAutoPurge();
    await vi.advanceTimersByTimeAsync(TRASH_PURGE_BOOT_DELAY_MS);
    expect(ids("scripts")).toEqual(["fresh", "live"]);
    expect(scriptsBus.version()).toBeGreaterThan(before);

    // "fresh" expires one day later; the hourly pass picks it up.
    await vi.advanceTimersByTimeAsync(DAY);
    expect(ids("scripts")).toEqual(["live"]);

    stop();
    addScript("late", NOW - 60 * DAY);
    await vi.advanceTimersByTimeAsync(2 * TRASH_PURGE_INTERVAL_MS);
    expect(ids("scripts")).toEqual(["late", "live"]);
  });

  it("reports the purge count without a list reload when nothing expired", async () => {
    registerSqlStorageAdapter();
    const before = scriptsBus.version();
    expect(await runTrashPurge(NOW - 70 * DAY)).toBe(0);
    expect(scriptsBus.version()).toBe(before);
  });

  it("counts the days left, at least one", () => {
    expect(daysUntilPurge(NOW, NOW)).toBe(30);
    expect(daysUntilPurge(NOW - 29.5 * DAY, NOW)).toBe(1);
    expect(daysUntilPurge(NOW - 40 * DAY, NOW)).toBe(1);
  });
});
