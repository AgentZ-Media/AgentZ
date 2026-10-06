// Folders + script-to-folder moves.
//
// Table `folders(id, name, created_at, updated_at, length_min_sec,
// length_max_sec)` plus the `scripts.folder_id` FK. Deleting a folder relies
// on `ON DELETE SET NULL` to surface its scripts in "All" rather than
// cascading the delete.
//
// tauri-plugin-sql exposes no transaction API in JS, so `moveScripts` issues
// N independent UPDATEs. A crash mid-loop leaves a partial move; the user
// can re-issue the action with no data damage - every UPDATE is independent.

import { getDb } from "./db";
import { validateLengthRange } from "./storage";
import type { Folder } from "./types";
import { t } from "../i18n";

/** Sentinel folder id for the virtual "Inbox" chip: scripts and ideas that
 *  sit in no folder (`folder_id IS NULL`). Not a UUID, so it can never
 *  collide with a real folder id (those are UUIDv4). Used as `folderId` in
 *  list queries to mean "ungrouped only" - distinct from `null`, which means
 *  every item, grouped or not. */
export const INBOX_FOLDER_ID = "__inbox__";

interface FolderRow {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  script_count: number;
  length_min_sec: number | null;
  length_max_sec: number | null;
}

const FOLDER_SELECT = `SELECT f.id, f.name, f.created_at, f.updated_at,
            f.length_min_sec, f.length_max_sec,
            (SELECT COUNT(*) FROM scripts s
              WHERE s.folder_id = f.id AND s.archived_at IS NULL) AS script_count
     FROM folders f`;

function rowToFolder(r: FolderRow): Folder {
  return {
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    updated_at: r.updated_at,
    script_count: r.script_count,
    length_min_sec: r.length_min_sec ?? null,
    length_max_sec: r.length_max_sec ?? null,
  };
}

async function getFolder(id: string): Promise<Folder> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(`${FOLDER_SELECT} WHERE f.id = $1`, [id]);
  if (rows.length === 0) {
    throw new Error(`not found: folder ${id}`);
  }
  return rowToFolder(rows[0]);
}

/** Total count of live (non-archived) scripts. Drives the "All" chip in
 *  the Browser, where summing per-folder counts would miss the
 *  ungrouped-script case. */
export async function countLiveScripts(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM scripts WHERE archived_at IS NULL",
  );
  return rows[0]?.n ?? 0;
}

export async function listFolders(): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.select<FolderRow[]>(
    `${FOLDER_SELECT} ORDER BY f.name COLLATE NOCASE ASC`,
  );
  return rows.map(rowToFolder);
}

export async function createFolder(name: string): Promise<Folder> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error(t("folder.error.emptyName"));
  }
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  await db.execute(
    "INSERT INTO folders (id, name, created_at, updated_at) VALUES ($1, $2, $3, $3)",
    [id, trimmed, now],
  );
  return {
    id,
    name: trimmed,
    created_at: now,
    updated_at: now,
    script_count: 0,
    length_min_sec: null,
    length_max_sec: null,
  };
}

export async function renameFolder(id: string, name: string): Promise<Folder> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error(t("folder.error.emptyName"));
  }
  const db = await getDb();
  const now = Date.now();
  const res = await db.execute(
    "UPDATE folders SET name = $1, updated_at = $2 WHERE id = $3",
    [trimmed, now, id],
  );
  if (res.rowsAffected === 0) {
    throw new Error(`not found: folder ${id}`);
  }
  return getFolder(id);
}

/** Sets (or clears, with null) the folder's target runtime range in whole
 *  seconds. Uses the adapter-independent `validateLengthRange`. */
export async function setFolderLengthRange(
  id: string,
  minSec: number | null,
  maxSec: number | null,
): Promise<Folder> {
  const range = validateLengthRange(minSec, maxSec);
  const db = await getDb();
  const res = await db.execute(
    "UPDATE folders SET length_min_sec = $1, length_max_sec = $2, updated_at = $3 WHERE id = $4",
    [range.minSec, range.maxSec, Date.now(), id],
  );
  if (res.rowsAffected === 0) {
    throw new Error(`not found: folder ${id}`);
  }
  return getFolder(id);
}

/** FK ON DELETE SET NULL takes care of orphaned scripts - they reappear
 *  in "All" without their folder_id. Scripts are never auto-deleted with
 *  the folder; that would be confusing and there's no UNDO. */
export async function deleteFolder(id: string): Promise<void> {
  const db = await getDb();
  const res = await db.execute("DELETE FROM folders WHERE id = $1", [id]);
  if (res.rowsAffected === 0) {
    throw new Error(`not found: folder ${id}`);
  }
}

export async function moveScript(
  scriptId: string,
  folderId: string | null,
): Promise<void> {
  const db = await getDb();
  if (folderId !== null) {
    const exists = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM folders WHERE id = $1",
      [folderId],
    );
    if ((exists[0]?.n ?? 0) === 0) {
      throw new Error(`not found: folder ${folderId}`);
    }
  }
  const now = Date.now();
  const res = await db.execute(
    "UPDATE scripts SET folder_id = $1, updated_at = $2 WHERE id = $3",
    [folderId, now, scriptId],
  );
  if (res.rowsAffected === 0) {
    throw new Error(`not found: script ${scriptId}`);
  }
}

export async function moveScripts(
  scriptIds: string[],
  folderId: string | null,
): Promise<void> {
  if (scriptIds.length === 0) return;
  const db = await getDb();
  if (folderId !== null) {
    const exists = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM folders WHERE id = $1",
      [folderId],
    );
    if ((exists[0]?.n ?? 0) === 0) {
      throw new Error(`not found: folder ${folderId}`);
    }
  }
  const now = Date.now();
  const missing: string[] = [];
  for (const sid of scriptIds) {
    const res = await db.execute(
      "UPDATE scripts SET folder_id = $1, updated_at = $2 WHERE id = $3",
      [folderId, now, sid],
    );
    if ((res.rowsAffected ?? 0) === 0) missing.push(sid);
  }
  if (missing.length > 0) {
    throw new Error(`not found: script(s) ${missing.join(", ")}`);
  }
}
