// FTS5 helpers - TS-side mirror of src-tauri/src/fts.rs.
//
// During the Rust -> TS migration both sides write to the same
// `scripts_fts` virtual table (DELETE + INSERT). The Rust scripts.rs
// commands still own create/update writes; this module is used by the
// TS-side snapshot restore (Phase 5) and global search (Phase 6), and
// will absorb the rest in Phase 7.

import { extractPlainText } from "./lex";
import { getDb } from "./db";

/** Turn a free-text query into an FTS5 MATCH expression: each word is
 *  wrapped in quotes (so punctuation can't crash the parser), the last
 *  word gets a `*` suffix for prefix matching, words are joined with
 *  spaces (FTS5 treats that as implicit AND).
 *
 *  Mirrors Rust's `sanitize_fts_query` (UAX #29 word segmentation via
 *  `unicode-segmentation::unicode_words`). The TS side uses
 *  `Intl.Segmenter` with `granularity: "word"` and the same
 *  `isWordLike` filter, which agrees with Rust on Latin/Cyrillic/etc.
 *
 *  CJK twist: V8/JSC's segmenter does dictionary-based grouping of Han
 *  ideographs ("中文" → one token), but UAX #29 (and the SQLite
 *  `unicode61` tokenizer the FTS index uses) splits them per character.
 *  We pre-isolate each Han char with whitespace so the segmenter
 *  produces the same per-char tokens Rust does - otherwise CJK queries
 *  would never match any indexed row. */
export function sanitizeFtsQuery(input: string): string {
  const s = input.trim().toLowerCase();
  if (s.length === 0) return "";

  // Force Han ideographs to be their own segments. Hangul / Hiragana /
  // Katakana could theoretically diverge too, but the app targets
  // German users and isn't tested against those scripts; documenting
  // the gap here in case it ever surfaces.
  const prepared = s.replace(/(\p{Script=Han})/gu, " $1 ");

  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const words: string[] = [];
  for (const piece of seg.segment(prepared)) {
    if (!piece.isWordLike) continue;
    if (piece.segment.length === 0) continue;
    const escaped = piece.segment.replaceAll('"', '""');
    words.push(`"${escaped}"`);
  }
  if (words.length === 0) return "";

  const lastIdx = words.length - 1;
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(i === lastIdx ? `${words[i]}*` : words[i]);
  }
  return out.join(" ");
}

/** Replace the FTS row for one script with the given title + content text.
 *  Mirrors Rust's `upsert_script_fts` - DELETE then INSERT, no UPSERT
 *  because FTS5 contentless tables don't support ON CONFLICT. */
export async function upsertScriptFts(
  scriptId: string,
  title: string,
  contentText: string,
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM scripts_fts WHERE script_id = $1", [scriptId]);
  await db.execute(
    "INSERT INTO scripts_fts (script_id, title, content_text) VALUES ($1, $2, $3)",
    [scriptId, title, contentText],
  );
}

export async function deleteScriptFts(scriptId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM scripts_fts WHERE script_id = $1", [scriptId]);
}

/** Convenience: read the script's title and content_json from the DB,
 *  derive plain text via the shared lex walker, and upsert. Same shape
 *  as Rust's `commands::scripts::refresh_fts_for_script`. Silently noops
 *  if the script no longer exists. */
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
