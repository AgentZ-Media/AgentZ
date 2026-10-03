// Global search across scripts.
//
// TS port of src-tauri/src/commands/search.rs (Migration Phase 6).
// Read-only path: the FTS5 index is still maintained by Rust's
// `commands::scripts::*` writes (Phase 7 absorbs that); we just query
// it. BM25 ranking + 8-token snippet with `<mark>` highlights.

import { getDb } from "./db";
import { sanitizeFtsQuery } from "./fts";
import type { SearchHit } from "./types";

interface Row {
  id: string;
  title: string;
  snippet: string;
  updated_at: number;
}

export async function globalSearch(
  query: string,
  limit = 50,
): Promise<SearchHit[]> {
  const clamped = Math.min(200, Math.max(1, limit));
  const q = sanitizeFtsQuery(query);
  if (q.length === 0) return [];
  const db = await getDb();
  const rows = await db.select<Row[]>(
    `SELECT s.id AS id, s.title AS title,
            snippet(scripts_fts, 2, '<mark>', '</mark>', '…', 16) AS snippet,
            s.updated_at AS updated_at
     FROM scripts_fts f
     JOIN scripts s ON s.id = f.script_id
     WHERE scripts_fts MATCH $1 AND s.archived_at IS NULL
     ORDER BY bm25(scripts_fts) ASC
     LIMIT $2`,
    [q, clamped],
  );
  return rows.map((r) => ({
    kind: "script" as const,
    id: r.id,
    title: r.title,
    snippet: r.snippet,
    meta: { updated_at: r.updated_at },
  }));
}
