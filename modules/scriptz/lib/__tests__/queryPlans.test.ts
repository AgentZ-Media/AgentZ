// @vitest-environment node
// The hot read paths of a large library must stay index-only on the real
// schema (every migration the desktop host installs). The summary columns
// sit behind content_json in each row: a list query that touches the table
// reads every script's content, so a new summary column must be added to
// idx_scripts_summary in a new migration.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { SUMMARY_COLUMNS } from "../scripts";
import { FOLDER_SELECT } from "../folders";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const migrations = new URL("../../../../apps/scriptz/src-tauri/migrations/", import.meta.url);

function plan(sql: string): string {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
  db.close();
  return rows.map((r) => r.detail).join(" | ");
}

describe("query plans of the library", () => {
  it("lists live scripts from the covering index, already sorted", () => {
    const p = plan(`SELECT ${SUMMARY_COLUMNS} FROM scripts WHERE 1=1 AND archived_at IS NULL ORDER BY updated_at DESC`);
    expect(p).toContain("COVERING INDEX idx_scripts_summary");
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("counts the scripts of every folder without reading script rows", () => {
    const p = plan(FOLDER_SELECT);
    expect(p).toContain("COVERING INDEX idx_scripts_folder_live");
  });
});
