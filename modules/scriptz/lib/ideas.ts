// Ideas inbox - standalone CRUD layer.
//
// An idea is a lightweight container ("What do I want to
// write about?") - not a script, not an editor. Converting transforms it
// into a new script but keeps the idea marked as "used" with
// a reference to the script ID. Deleting an idea does not touch the
// associated script content; the script stays in the
// browser. If the script is deleted, the ON DELETE SET NULL FK resets
// the idea's script_id - the idea stays in the "used" tab,
// just without a clickable link.

import { createScript } from "./scripts";
import { getDb } from "./db";
import { ideasBus } from "./ideasBus";
import { scriptsBus } from "./scriptsBus";
import { foldersBus } from "./foldersBus";
import type { Idea, ScriptSummary } from "./types";
import { t } from "../i18n";

interface IdeaRow {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  used_at: number | null;
  script_id: string | null;
  folder_id: string | null;
  source_chat_id: string | null;
}

function rowToIdea(r: IdeaRow): Idea {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes ?? "",
    created_at: r.created_at,
    used_at: r.used_at,
    script_id: r.script_id,
    folder_id: r.folder_id,
    source_chat_id: r.source_chat_id ?? null,
  };
}

export async function listIdeas(): Promise<Idea[]> {
  const db = await getDb();
  const rows = await db.select<IdeaRow[]>(
    `SELECT id, title, notes, created_at, used_at, script_id, folder_id, source_chat_id
     FROM ideas
     ORDER BY created_at DESC`,
  );
  return rows.map(rowToIdea);
}

export async function createIdea(input: {
  title: string;
  notes?: string;
  folderId?: string | null;
  /** Agent session the idea was saved from (agent mode). */
  sourceChatId?: string | null;
}): Promise<Idea> {
  const title = input.title.trim();
  if (!title) throw new Error(t("idea.error.emptyTitle"));
  const id = crypto.randomUUID();
  const now = Date.now();
  const folderId = input.folderId ?? null;
  const sourceChatId = input.sourceChatId ?? null;
  const db = await getDb();
  await db.execute(
    `INSERT INTO ideas (id, title, notes, created_at, folder_id, source_chat_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, title, input.notes ?? "", now, folderId, sourceChatId],
  );
  ideasBus.bump();
  return {
    id, title, notes: input.notes ?? "", created_at: now,
    used_at: null, script_id: null, folder_id: folderId, source_chat_id: sourceChatId,
  };
}

export async function updateIdea(input: {
  id: string;
  title?: string;
  notes?: string;
}): Promise<Idea> {
  const db = await getDb();
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new Error(t("idea.error.emptyTitle"));
    await db.execute(`UPDATE ideas SET title = $1 WHERE id = $2`, [trimmed, input.id]);
  }
  if (input.notes !== undefined) {
    await db.execute(`UPDATE ideas SET notes = $1 WHERE id = $2`, [input.notes, input.id]);
  }
  const rows = await db.select<IdeaRow[]>(
    `SELECT id, title, notes, created_at, used_at, script_id, folder_id, source_chat_id FROM ideas WHERE id = $1`,
    [input.id],
  );
  if (rows.length === 0) throw new Error(`not found: idea ${input.id}`);
  ideasBus.bump();
  return rowToIdea(rows[0]);
}

export async function deleteIdea(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM ideas WHERE id = $1`, [id]);
  ideasBus.bump();
}

/** Puts a deleted idea back exactly as it was (undo of deleteIdea). A
 *  folder, script or agent session that is gone by now is dropped from the
 *  link instead of failing the restore. */
export async function restoreIdea(idea: Idea): Promise<void> {
  const db = await getDb();
  const exists = async (table: "folders" | "scripts" | "agent_chats", id: string | null | undefined) => {
    if (!id) return false;
    const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = $1`, [id]);
    return (rows[0]?.n ?? 0) > 0;
  };
  const folderId = (await exists("folders", idea.folder_id)) ? idea.folder_id : null;
  const scriptId = (await exists("scripts", idea.script_id)) ? idea.script_id : null;
  const sourceChatId = (await exists("agent_chats", idea.source_chat_id)) ? idea.source_chat_id ?? null : null;
  await db.execute(
    `INSERT OR IGNORE INTO ideas (id, title, notes, created_at, used_at, script_id, folder_id, source_chat_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [idea.id, idea.title, idea.notes ?? "", idea.created_at, idea.used_at, scriptId, folderId, sourceChatId],
  );
  ideasBus.bump();
}

/** Moves an idea into a folder (or out of any folder when null). Shares
 *  the folders table with scripts; mirrors folders.ts::moveScript. */
export async function moveIdea(
  ideaId: string,
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
  const res = await db.execute(
    `UPDATE ideas SET folder_id = $1 WHERE id = $2`,
    [folderId, ideaId],
  );
  if (res.rowsAffected === 0) {
    throw new Error(`not found: idea ${ideaId}`);
  }
  ideasBus.bump();
}

/** Marks an open idea as used by an existing script (agent mode: a draft
 *  written for this idea became a script). False when the idea is gone or
 *  was already used - the script is kept either way. */
export async function markIdeaUsed(ideaId: string, scriptId: string): Promise<boolean> {
  const db = await getDb();
  const res = await db.execute(
    `UPDATE ideas SET used_at = $1, script_id = $2 WHERE id = $3 AND used_at IS NULL`,
    [Date.now(), scriptId, ideaId],
  );
  ideasBus.bump();
  return res.rowsAffected === 1;
}

/** Converts an idea into a new script. The idea is kept
 *  and marked with `used_at` + `script_id`. The caller can optionally
 *  pass a folder. */
export async function convertIdeaToScript(input: {
  ideaId: string;
  folderId?: string | null;
  /** If true, the note is carried over as the first action into the new
   *  script. Default false: the note stays on the idea and the inspector
   *  shows it under "Aus der Idee". */
  notesAsAction?: boolean;
}): Promise<{ idea: Idea; script: ScriptSummary }> {
  const db = await getDb();
  const rows = await db.select<IdeaRow[]>(
    `SELECT id, title, notes, created_at, used_at, script_id, folder_id, source_chat_id FROM ideas WHERE id = $1`,
    [input.ideaId],
  );
  if (rows.length === 0) throw new Error(`not found: idea ${input.ideaId}`);
  const ideaRow = rows[0];
  // The new script inherits the idea's folder unless the caller picks a
  // different one - so a "Kunde X" idea converts into a "Kunde X" script.
  const targetFolderId =
    input.folderId !== undefined ? input.folderId : ideaRow.folder_id;
  if (ideaRow.used_at !== null) {
    throw new Error(t("error.ideaAlreadyConverted"));
  }

  // Step 1: reserve the idea via CAS BEFORE creating a script.
  // Plugin-sql has no transactions, so we serialize
  // concurrent conversions via a conditional UPDATE - only one
  // wins. Losers get an error instead of duplicate scripts.
  const claimedAt = Date.now();
  const claim = await db.execute(
    `UPDATE ideas SET used_at = $1 WHERE id = $2 AND used_at IS NULL`,
    [claimedAt, ideaRow.id],
  );
  if (claim.rowsAffected !== 1) {
    throw new Error(t("error.ideaAlreadyConverted"));
  }

  const notesAsAction = input.notesAsAction ?? false;
  const seedJson = buildScriptSeed({
    notes: notesAsAction ? ideaRow.notes : "",
  });

  // Step 2: create the script. If that fails, release the
  // reservation so the idea doesn't stay stuck as
  // "used" without a link forever.
  let script: ScriptSummary;
  try {
    script = await createScript(
      ideaRow.title,
      seedJson,
      targetFolderId,
    );
  } catch (err) {
    await db.execute(
      `UPDATE ideas SET used_at = NULL, script_id = NULL WHERE id = $1 AND used_at = $2`,
      [ideaRow.id, claimedAt],
    );
    throw err;
  }

  // Step 3: backfill script_id. If this update fails,
  // the script is preserved - the idea just shows no link
  // in the "used" tab (see migration 003 docs, ON DELETE SET NULL).
  try {
    await db.execute(
      `UPDATE ideas SET script_id = $1 WHERE id = $2`,
      [script.id, ideaRow.id],
    );
  } catch (err) {
    console.warn("[scriptz] convertIdeaToScript: script_id backref failed", err);
  }

  // Bump all three buses: the new script appears in the browser list,
  // the idea disappears from "open" and appears in "used".
  scriptsBus.bump();
  foldersBus.bump();
  ideasBus.bump();

  const updatedIdea: Idea = {
    ...rowToIdea(ideaRow),
    used_at: claimedAt,
    script_id: script.id,
  };
  return { idea: updatedIdea, script };
}

/** Generates a Lexical state that starts the new script with an empty
 *  character block (default) OR with an action block when the
 *  idea provides notes. Mirrors the welcome seed structure
 *  so existing plugins (allcaps, smartEnter etc.) work. */
function buildScriptSeed(opts: { notes: string }): string {
  const trimmed = opts.notes.trim();
  if (!trimmed) {
    return JSON.stringify({
      root: {
        type: "root", version: 1, direction: null, format: "", indent: 0,
        children: [
          {
            type: "scriptz-character", version: 1,
            characterName: "", direction: null, format: "", indent: 0,
            children: [],
          },
        ],
      },
    });
  }
  return JSON.stringify({
    root: {
      type: "root", version: 1, direction: null, format: "", indent: 0,
      children: [
        {
          type: "scriptz-action", version: 1,
          direction: null, format: "", indent: 0,
          children: [
            {
              detail: 0, format: 0, mode: "normal", style: "",
              text: trimmed, type: "text", version: 1,
            },
          ],
        },
        {
          type: "scriptz-character", version: 1,
          characterName: "", direction: null, format: "", indent: 0,
          children: [],
        },
      ],
    },
  });
}
