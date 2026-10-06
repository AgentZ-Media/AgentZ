// FTS5 helpers for the `scripts_fts` virtual table (DELETE + INSERT on every
// content write), used by script saves, snapshot restore and global search.
//
// `scripts_fts_map` (migration 013) pins each script to one FTS rowid.
// `script_id` is UNINDEXED in the FTS table, so `WHERE script_id = ?` scans
// the whole index on every save; the rowid is a direct lookup.

import { extractPlainText } from "./lex";
import { getDb } from "./db";

/** Turn a free-text query into an FTS5 MATCH expression: each word is
 *  wrapped in quotes (so punctuation can't crash the parser), the last
 *  word gets a `*` suffix for prefix matching, words are joined with
 *  spaces (FTS5 treats that as implicit AND).
 *
 *  Word segmentation follows UAX #29 via `Intl.Segmenter` with
 *  `granularity: "word"` and the `isWordLike` filter.
 *
 *  The `unicode61` tokenizer of the index only splits at separators, so
 *  a run without separators ("我喜欢中文", "abc中文") is ONE indexed
 *  token. The segmenter splits such runs by dictionary, so adjacent
 *  word-like segments are joined again - otherwise CJK queries would
 *  never match. */
export function sanitizeFtsQuery(input: string): string {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return "";

  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const tokens: string[] = [];
  let tokenEnd = -1;
  for (const piece of seg.segment(s)) {
    if (!piece.isWordLike || piece.segment.length === 0) continue;
    if (piece.index === tokenEnd) tokens[tokens.length - 1] += piece.segment;
    else tokens.push(piece.segment);
    tokenEnd = piece.index + piece.segment.length;
  }
  if (tokens.length === 0) return "";

  const lastIdx = tokens.length - 1;
  return tokens
    .map((token, i) => {
      const quoted = `"${token.replaceAll('"', '""')}"`;
      return i === lastIdx ? `${quoted}*` : quoted;
    })
    .join(" ");
}

const FTS_ROWID = "(SELECT fts_rowid FROM scripts_fts_map WHERE script_id = $1)";

/** Replace the FTS row for one script with the given title + content text.
 *  One statement (`OR REPLACE` on the mapped rowid drops the old tokens), so
 *  a rename and an autosave writing the same script at once cannot
 *  interleave into a constraint error. */
export async function upsertScriptFts(
  scriptId: string,
  title: string,
  contentText: string,
): Promise<void> {
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO scripts_fts_map (script_id) VALUES ($1)", [scriptId]);
  await db.execute(
    `INSERT OR REPLACE INTO scripts_fts (rowid, script_id, title, content_text) VALUES (${FTS_ROWID}, $1, $2, $3)`,
    [scriptId, title, contentText],
  );
}

export async function deleteScriptFts(scriptId: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM scripts_fts WHERE rowid = ${FTS_ROWID}`, [scriptId]);
  await db.execute("DELETE FROM scripts_fts_map WHERE script_id = $1", [scriptId]);
}

/** Convenience: read the script's title and content_json from the DB,
 *  derive plain text via the shared lex walker, and upsert. Silently
 *  noops if the script no longer exists. */
export async function refreshFtsForScript(scriptId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ title: string; content_json: string }[]>(
    "SELECT title, content_json FROM scripts WHERE id = $1",
    [scriptId],
  );
  if (rows.length === 0) return;
  const { title, content_json } = rows[0];
  const contentText = extractPlainText(content_json);
  await upsertScriptFts(scriptId, title, contentText);
}
