// Snapshots - auto + manual versioning for a script's content.
//
// TS port of src-tauri/src/commands/snapshots.rs (Migration Phase 5).
// Schema is unchanged: `snapshots(id, script_id, content_json, trigger,
// created_at)`, FK to `scripts.id` ON DELETE CASCADE. Cap is 50 per
// script (oldest dropped automatically on each create).
//
// Caveat (same as earlier phases): tauri-plugin-sql has no transaction
// API in JS, so multi-statement operations run as independent
// auto-committed steps. Effects:
//   - createSnapshot: a crash between INSERT and the trim DELETE
//     could leave a 51st row briefly; the next create_snapshot trims
//     it. No data loss either way.
//   - restoreSnapshot: backup INSERT + content UPDATE + FTS refresh
//     are sequential. A crash mid-flow leaves the script either at
//     its old content (if before UPDATE) or at the new content with
//     a fresh backup snapshot present (if after). Worst case the FTS
//     index lags one save behind, which the next save corrects.

import { getDb } from "./db";
import { refreshFtsForScript } from "./fts";
import { normalizeLegacyContent } from "./legacyBlocks";
import type { Snapshot, SnapshotMeta } from "./types";

const MAX_SNAPSHOTS_PER_SCRIPT = 50;

export async function createSnapshot(
  scriptId: string,
  trigger: "auto" | "manual",
): Promise<SnapshotMeta> {
  const db = await getDb();
  const triggerNorm: "auto" | "manual" = trigger === "manual" ? "manual" : "auto";

  const rows = await db.select<{ content_json: string }[]>(
    "SELECT content_json FROM scripts WHERE id = $1",
    [scriptId],
  );
  if (rows.length === 0) {
    throw new Error(`not found: script ${scriptId}`);
  }
  const contentJson = rows[0].content_json;

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    "INSERT INTO snapshots (id, script_id, content_json, trigger, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, scriptId, contentJson, triggerNorm, now],
  );
  // Cap to MAX_SNAPSHOTS_PER_SCRIPT, oldest first.
  await db.execute(
    `DELETE FROM snapshots WHERE id IN (
       SELECT id FROM snapshots WHERE script_id = $1
       ORDER BY created_at DESC
       LIMIT -1 OFFSET $2
     )`,
    [scriptId, MAX_SNAPSHOTS_PER_SCRIPT],
  );

  return {
    id,
    script_id: scriptId,
    trigger: triggerNorm,
    created_at: now,
  };
}

export async function listSnapshots(scriptId: string): Promise<SnapshotMeta[]> {
  const db = await getDb();
  return db.select<SnapshotMeta[]>(
    `SELECT id, script_id, trigger, created_at FROM snapshots
     WHERE script_id = $1 ORDER BY created_at DESC`,
    [scriptId],
  );
}

export async function getSnapshot(id: string): Promise<Snapshot> {
  const db = await getDb();
  const rows = await db.select<Snapshot[]>(
    "SELECT id, script_id, content_json, trigger, created_at FROM snapshots WHERE id = $1",
    [id],
  );
  if (rows.length === 0) {
    throw new Error(`not found: snapshot ${id}`);
  }
  return rows[0];
}

export async function restoreSnapshot(snapshotId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ script_id: string; content_json: string }[]>(
    "SELECT script_id, content_json FROM snapshots WHERE id = $1",
    [snapshotId],
  );
  if (rows.length === 0) {
    throw new Error(`not found: snapshot ${snapshotId}`);
  }
  const scriptId = rows[0].script_id;
  // Snapshots taken before the block-type reduction may still contain
  // retired block types - restore them as action blocks.
  const restoredContent = normalizeLegacyContent(rows[0].content_json).json;

  const now = Date.now();

  // Take an auto-snapshot of the current content before overwriting.
  const curRows = await db.select<{ content_json: string }[]>(
    "SELECT content_json FROM scripts WHERE id = $1",
    [scriptId],
  );
  if (curRows.length === 0) {
    throw new Error(`not found: script ${scriptId}`);
  }
  const backupId = crypto.randomUUID();
  await db.execute(
    "INSERT INTO snapshots (id, script_id, content_json, trigger, created_at) VALUES ($1, $2, $3, 'auto', $4)",
    [backupId, scriptId, curRows[0].content_json, now],
  );
  // Restore counts as a snapshot insert; honour the 50-per-script cap so
  // repeated restores (or restore-after-many-saves) can't grow the table
  // unbounded. Mirrors createSnapshot's trim DELETE.
  await db.execute(
    `DELETE FROM snapshots WHERE id IN (
       SELECT id FROM snapshots WHERE script_id = $1
       ORDER BY created_at DESC
       LIMIT -1 OFFSET $2
     )`,
    [scriptId, MAX_SNAPSHOTS_PER_SCRIPT],
  );

  await db.execute(
    "UPDATE scripts SET content_json = $1, updated_at = $2 WHERE id = $3",
    [restoredContent, now, scriptId],
  );
  await refreshFtsForScript(scriptId);
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM snapshots WHERE id = $1", [id]);
}
