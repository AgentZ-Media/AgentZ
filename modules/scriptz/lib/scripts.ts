// Script CRUD.
//
// Reconciliation: every content save walks the JSON for character
// names and picks colours by the override > sticky > default > palette
// priority, back-filling the app-wide default registry for unseen
// names. Existing scripts keep their colour assignments.
//
// FK behaviour: tauri-plugin-sql opens connections via sqlx-sqlite,
// which sets `PRAGMA foreign_keys = ON` by default. DELETEs on
// `scripts` therefore cascade into `snapshots` (declared ON DELETE
// CASCADE in migration v2) without an explicit pre-delete here.
//
// Transaction caveat: plugin-sql exposes no JS transaction API, so
// multi-statement updates run as independent auto-committed
// statements. For update_script that means a concurrent save can
// interleave field writes - in practice all callers go through the
// debounced save in Editor.tsx, so the race window is small. FTS
// refresh runs after the row update; a search hit landing in the
// micro-window between can show stale snippets, which the next save
// corrects.

import {
  DEFAULT_PALETTE,
  eqIgnoreAsciiCase,
  loadColorRecords,
  parseCharsMeta,
  serializeCharsMeta,
  upsertDefaultColor,
  type ColorRecord,
} from "./characterColors";
import { characterUsageBus, dropsCharacterNames } from "./characterUsage";
import { countWordsInContent, recordWordDelta } from "./dailyWords";
import { getDb } from "./db";
import { INBOX_FOLDER_ID } from "./folders";
import { deleteScriptFts, refreshFtsForScript } from "./fts";
import { dialogWordsByCharacter, extractCharacterNames } from "./lex";
import {
  RUNTIME_STATS_SENTINEL,
  runtimeStatsFromContent,
} from "./runtime";
import { normalizeLegacyContent } from "./legacyBlocks";
import { firstStageId, isKnownStage, resolveStageId } from "./stages";
import {
  type Script,
  type ScriptCharacter,
  type ScriptStatus,
  type ScriptSummary,
} from "./types";
import { t } from "../i18n";

interface SummaryRow {
  id: string;
  title: string;
  highlighting_enabled: number | null;
  characters_meta: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  page_count: number;
  last_word_count: number;
  dialog_word_count: number;
  direction_block_count: number;
  folder_id: string | null;
  status: string | null;
  status_changed_at: number | null;
}

const SUMMARY_COLUMNS =
  "id, title, highlighting_enabled, characters_meta, " +
  "created_at, updated_at, archived_at, page_count, " +
  "last_word_count, dialog_word_count, direction_block_count, folder_id, " +
  "status, status_changed_at";

function summaryRowToScript(r: SummaryRow): ScriptSummary {
  return {
    id: r.id,
    title: r.title,
    highlighting_enabled: r.highlighting_enabled,
    characters: parseCharsMeta(r.characters_meta),
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived_at: r.archived_at,
    page_count: r.page_count,
    word_count: r.last_word_count,
    dialog_word_count: r.dialog_word_count,
    direction_block_count: r.direction_block_count,
    folder_id: r.folder_id,
    // A stage that no longer exists (manual DB edit, file from another
    // install) reads as the first stage instead of breaking the UI. The row
    // itself keeps its value until the stage is set again.
    status: resolveStageId(r.status),
    status_changed_at: r.status_changed_at ?? null,
  };
}

interface FullRow extends SummaryRow {
  content_json: string;
}

async function rowToSummary(id: string): Promise<ScriptSummary> {
  const db = await getDb();
  const rows = await db.select<SummaryRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM scripts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    throw new Error(`not found: script ${id}`);
  }
  return summaryRowToScript(rows[0]);
}

export async function getScript(id: string): Promise<Script> {
  const db = await getDb();
  const rows = await db.select<FullRow[]>(
    `SELECT ${SUMMARY_COLUMNS}, content_json FROM scripts WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) {
    throw new Error(`not found: script ${id}`);
  }
  const r = rows[0];
  return {
    ...summaryRowToScript(r),
    content_json: r.content_json,
  };
}

export interface ListScriptsQuery {
  includeArchived?: boolean | null;
  onlyArchived?: boolean | null;
  sort?: "updated" | "created" | "title" | null;
  query?: string | null;
  limit?: number | null;
  offset?: number | null;
  folderId?: string | null;
  status?: ScriptStatus | null;
}

export async function listScripts(q: ListScriptsQuery): Promise<ScriptSummary[]> {
  const db = await getDb();
  // Single round-trip: all columns in one SELECT instead of N+1
  // (previously: first SELECT id …, then a separate SELECT per row
  // via rowToSummary). Every boot paid a Tauri IPC hop per script -
  // 3 scripts meant 4 calls instead of 1.
  let sql = `SELECT ${SUMMARY_COLUMNS} FROM scripts WHERE 1=1`;
  const args: (string | number)[] = [];
  let p = 1;

  const onlyArchived = q.onlyArchived ?? false;
  const includeArchived = q.includeArchived ?? false;
  if (onlyArchived) {
    sql += " AND archived_at IS NOT NULL";
  } else if (!includeArchived) {
    sql += " AND archived_at IS NULL";
  }

  const trimmedQuery = q.query?.trim();
  if (trimmedQuery && trimmedQuery.length > 0) {
    sql += ` AND title LIKE $${p}`;
    args.push(`%${trimmedQuery}%`);
    p++;
  }

  if (q.folderId === INBOX_FOLDER_ID) {
    // Virtual "Inbox" folder: only ungrouped scripts.
    sql += " AND folder_id IS NULL";
  } else if (q.folderId !== undefined && q.folderId !== null) {
    sql += ` AND folder_id = $${p}`;
    args.push(q.folderId);
    p++;
  }

  if (q.status !== undefined && q.status !== null) {
    sql += ` AND status = $${p}`;
    args.push(q.status);
    p++;
  }

  const sort = q.sort ?? "updated";
  if (sort === "created") {
    sql += " ORDER BY created_at DESC";
  } else if (sort === "title") {
    sql += " ORDER BY title COLLATE NOCASE ASC";
  } else {
    sql += " ORDER BY updated_at DESC";
  }

  if (q.limit !== undefined && q.limit !== null) {
    sql += ` LIMIT $${p}`;
    args.push(q.limit);
    p++;
    if (q.offset !== undefined && q.offset !== null) {
      sql += ` OFFSET $${p}`;
      args.push(q.offset);
      p++;
    }
  }

  const rows = await db.select<SummaryRow[]>(sql, args);
  return rows.map(summaryRowToScript);
}

export async function createScript(
  title: string | null,
  initialContentJson: string | null,
  folderId: string | null,
): Promise<ScriptSummary> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const finalTitle = title ?? t("common.untitled");
  // Imported / seeded content may still carry retired block types.
  const contentJson =
    initialContentJson !== null
      ? normalizeLegacyContent(initialContentJson).json
      : emptyLexicalState();

  const records = await loadColorRecords();
  const { chars, newDefaults } = reconcileCharsFromContent([], contentJson, records);
  for (const [n, c] of newDefaults) {
    await upsertDefaultColor(n, c, now);
  }
  const charsJson = serializeCharsMeta(chars);

  if (folderId !== null) {
    const exists = await db.select<{ n: number }[]>(
      "SELECT COUNT(*) AS n FROM folders WHERE id = $1",
      [folderId],
    );
    if ((exists[0]?.n ?? 0) === 0) {
      throw new Error(`not found: folder ${folderId}`);
    }
  }

  // Initial word count of the seed content. We don't want the
  // first real save to count the full welcome text as "written today";
  // therefore last_word_count is set directly to the word count of the
  // seed. An idea-to-script conversion with notes-action
  // is then also accounted for correctly (the few note words
  // don't count as writing activity because they weren't added during
  // the save).
  const initialWordCount = countWordsInContent(contentJson);
  const runtime = runtimeStatsFromContent(contentJson);

  await db.execute(
    `INSERT INTO scripts (id, title, highlighting_enabled, content_json, characters_meta,
                          created_at, updated_at, page_count, folder_id, last_word_count,
                          dialog_word_count, direction_block_count, status, status_changed_at)
     VALUES ($1, $2, NULL, $3, $4, $5, $5, 1, $6, $7, $8, $9, $10, NULL)`,
    [
      id,
      finalTitle,
      contentJson,
      charsJson,
      now,
      folderId,
      initialWordCount,
      runtime.dialogWords,
      runtime.directionBlocks,
      firstStageId(),
    ],
  );
  await refreshFtsForScript(id);
  return rowToSummary(id);
}

export async function duplicateScript(id: string): Promise<ScriptSummary> {
  const src = await getScript(id);
  const db = await getDb();
  const newId = crypto.randomUUID();
  const now = Date.now();
  const newTitle = `${src.title}${t("script.duplicateSuffix")}`;
  const charsJson = serializeCharsMeta(src.characters);
  // Duplicate: set last_word_count to the current word count of the source
  // so a direct edit afterwards only counts the delta
  // (otherwise the first save would count the whole copied text as
  // "written today").
  // The copy is a fresh draft: it always starts at the first stage,
  // whatever stage the source is in.
  const contentJson = normalizeLegacyContent(src.content_json).json;
  const wc = countWordsInContent(contentJson);
  const runtime = runtimeStatsFromContent(contentJson);
  await db.execute(
    `INSERT INTO scripts (id, title, highlighting_enabled, content_json, characters_meta,
                          created_at, updated_at, page_count, folder_id, last_word_count,
                          dialog_word_count, direction_block_count, status, status_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, NULL)`,
    [
      newId,
      newTitle,
      src.highlighting_enabled,
      contentJson,
      charsJson,
      now,
      src.page_count,
      src.folder_id,
      wc,
      runtime.dialogWords,
      runtime.directionBlocks,
      firstStageId(),
    ],
  );
  await refreshFtsForScript(newId);
  return rowToSummary(newId);
}

export async function renameScript(id: string, title: string): Promise<ScriptSummary> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "UPDATE scripts SET title = $1, updated_at = $2 WHERE id = $3",
    [title, now, id],
  );
  await refreshFtsForScript(id);
  return rowToSummary(id);
}

/** Moves a script to another production stage. `status_changed_at` is
 *  only bumped when the status really changes (re-selecting the current
 *  stage is a no-op). `updated_at` stays untouched - a stage change is not
 *  a content edit and must not reorder "recently edited" lists. */
export async function setScriptStatus(
  id: string,
  status: ScriptStatus,
): Promise<ScriptSummary> {
  if (!isKnownStage(status)) {
    throw new Error(`invalid script status: ${String(status)}`);
  }
  const db = await getDb();
  // The `status IS NOT $1` guard keeps status_changed_at stable when the
  // current stage is re-selected. Zero affected rows = unknown id OR no
  // change; rowToSummary throws for the former.
  await db.execute(
    "UPDATE scripts SET status = $1, status_changed_at = $2 WHERE id = $3 AND status IS NOT $1",
    [status, Date.now(), id],
  );
  return rowToSummary(id);
}

/** Number of scripts (trash included) stored with this stage id. */
export async function countScriptsWithStatus(status: ScriptStatus): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM scripts WHERE status = $1",
    [status],
  );
  return rows[0]?.n ?? 0;
}

/** Moves every script (trash included) from one stage to another, e.g.
 *  before the stage `from` is removed from the pipeline. Like a merge of
 *  two stages it keeps `status_changed_at` and `updated_at`. Returns the
 *  number of moved scripts. */
export async function reassignScriptStatus(
  from: ScriptStatus,
  to: ScriptStatus,
): Promise<number> {
  if (!isKnownStage(to)) {
    throw new Error(`invalid script status: ${String(to)}`);
  }
  if (from === to) return 0;
  const db = await getDb();
  const res = await db.execute("UPDATE scripts SET status = $1 WHERE status = $2", [to, from]);
  return res.rowsAffected;
}

export interface UpdateScriptInput {
  id: string;
  title?: string;
  /** `null` clears the override (= follow global default). `undefined` =
   *  no change. The Rust `Option<Option<i64>>` shape collapses to this
   *  in JS because `undefined` simply isn't sent. */
  highlightingEnabled?: number | null;
  contentJson?: string;
  /** Caller-supplied override of the per-script character list (e.g.
   *  the user picked a colour). Replaces characters_meta directly,
   *  bypassing the reconcile step. */
  characters?: ScriptCharacter[];
  /** Internal rewrite (legacy-block migration): no daily-word booking,
   *  `updated_at` untouched. See `UpdateScriptInput`. */
  internalRewrite?: boolean;
}

export async function updateScript(input: UpdateScriptInput): Promise<ScriptSummary> {
  const db = await getDb();
  const now = Date.now();

  const existRows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM scripts WHERE id = $1",
    [input.id],
  );
  if ((existRows[0]?.n ?? 0) === 0) {
    throw new Error(`not found: script ${input.id}`);
  }

  if (input.title !== undefined) {
    await db.execute(
      "UPDATE scripts SET title = $1, updated_at = $2 WHERE id = $3",
      [input.title, now, input.id],
    );
  }
  if (input.highlightingEnabled !== undefined) {
    await db.execute(
      "UPDATE scripts SET highlighting_enabled = $1, updated_at = $2 WHERE id = $3",
      [input.highlightingEnabled, now, input.id],
    );
  }
  if (input.contentJson !== undefined) {
    // Content never gets persisted with retired block types (cheap
    // substring fast path when there's nothing to convert).
    const contentJson = normalizeLegacyContent(input.contentJson).json;
    const internal = input.internalRewrite === true;
    // Compare-and-swap loop around diff-on-save: plugin-sql has no
    // transactions, so we guard the word-delta bookkeeping via a
    // conditional UPDATE. If two parallel saves read the same
    // last_word_count, both deltas would otherwise land in daily_word_log
    // and today's bucket would be double-counted.
    const newWordCount = countWordsInContent(contentJson);
    const runtime = runtimeStatsFromContent(contentJson);
    const records = await loadColorRecords();
    let delta = 0;
    let attempts = 0;
    let droppedNames = false;
    while (true) {
      attempts++;
      const metaRows = await db.select<{
        characters_meta: string;
        last_word_count: number | null;
        updated_at: number;
      }[]>(
        "SELECT characters_meta, last_word_count, updated_at FROM scripts WHERE id = $1",
        [input.id],
      );
      if (metaRows.length === 0) {
        throw new Error(`not found: script ${input.id}`);
      }
      const lastWordCount = metaRows[0]?.last_word_count ?? 0;
      const prevMeta = metaRows[0]?.characters_meta ?? "[]";
      const charsJson = await reconcileCharsMeta(prevMeta, contentJson, records, now);
      droppedNames = dropsCharacterNames(parseCharsMeta(prevMeta), parseCharsMeta(charsJson));

      // last_word_count === -1 is the sentinel from migration 003 for
      // existing scripts: the first save after the update only normalizes
      // the count without booking the entire prior word total as "written
      // today".
      const isFirstMeasurement = lastWordCount < 0;
      // Internal rewrites (legacy-block migration) only normalize the
      // count - converting block types is not writing.
      const candidateDelta =
        isFirstMeasurement || internal ? 0 : newWordCount - lastWordCount;
      const stamp = internal ? (metaRows[0]?.updated_at ?? now) : now;

      const result = await db.execute(
        `UPDATE scripts
           SET content_json = $1, characters_meta = $2, updated_at = $3, last_word_count = $4,
               dialog_word_count = $5, direction_block_count = $6
           WHERE id = $7 AND last_word_count = $8`,
        [
          contentJson,
          charsJson,
          stamp,
          newWordCount,
          runtime.dialogWords,
          runtime.directionBlocks,
          input.id,
          lastWordCount,
        ],
      );
      if (result.rowsAffected === 1) {
        delta = candidateDelta;
        break;
      }
      // Retry limit as emergency brake: in practice the
      // 250 ms debounce in Editor.tsx serializes all saves of the same script -
      // a conflict here should occur at most once.
      if (attempts >= 5) {
        // Fallback: write content unconditionally so the user's keystrokes
        // are NEVER silently lost. We sacrifice the daily-stats delta
        // (which assumes a known prior word count) to keep the body safe.
        // The daily counter will self-correct on the next normal save.
        console.warn("[scriptz] CAS retry limit reached, forcing unconditional save", input.id);
        await db.execute(
          `UPDATE scripts
             SET content_json = $1, characters_meta = $2, updated_at = $3, last_word_count = $4,
                 dialog_word_count = $5, direction_block_count = $6
             WHERE id = $7`,
          [
            contentJson,
            charsJson,
            stamp,
            newWordCount,
            runtime.dialogWords,
            runtime.directionBlocks,
            input.id,
          ],
        );
        delta = 0;
        break;
      }
    }

    if (droppedNames) characterUsageBus.notifyNamesDropped();
    if (delta > 0) {
      try {
        await recordWordDelta(delta);
      } catch (err) {
        // Statistics write errors must not kill the save.
        console.warn("[scriptz] daily word log update failed", err);
      }
    }
  }
  // characters_meta is already reconciled from input.contentJson above.
  // If a caller passed both, the contentJson reconciliation wins -
  // overwriting it with input.characters here would silently revert the
  // sticky-color logic. Only honour input.characters when no contentJson
  // change accompanies it (e.g. colour-picker edits without body change).
  if (input.characters !== undefined && input.contentJson === undefined) {
    const charsJson = serializeCharsMeta(input.characters);
    await db.execute(
      "UPDATE scripts SET characters_meta = $1, updated_at = $2 WHERE id = $3",
      [charsJson, now, input.id],
    );
  }
  await refreshFtsForScript(input.id);
  return rowToSummary(input.id);
}

/** Writes content restored from a snapshot and reconciles every derived
 *  column with it: word count, dialog word count, direction block count,
 *  characters_meta and the FTS row. Unlike `updateScript`, restored words
 *  are NOT booked as written today - `last_word_count` (incl. the -1
 *  sentinel) is reset to the restored count, so the next real edit books
 *  only its own delta. `updated_at` moves to `now` (a restore is a
 *  user-visible change). */
export async function writeRestoredContent(
  id: string,
  rawContentJson: string,
  now: number = Date.now(),
): Promise<void> {
  const db = await getDb();
  // Snapshots taken before the block-type reduction may still contain
  // retired block types - restore them as action blocks.
  const contentJson = normalizeLegacyContent(rawContentJson).json;
  const wordCount = countWordsInContent(contentJson);
  const runtime = runtimeStatsFromContent(contentJson);
  const records = await loadColorRecords();
  const metaRows = await db.select<{ characters_meta: string }[]>(
    "SELECT characters_meta FROM scripts WHERE id = $1",
    [id],
  );
  if (metaRows.length === 0) {
    throw new Error(`not found: script ${id}`);
  }
  const prevMeta = metaRows[0]?.characters_meta ?? "[]";
  const charsJson = await reconcileCharsMeta(prevMeta, contentJson, records, now);
  // Unconditional on purpose: a concurrent CAS save in updateScript sees
  // the changed last_word_count and retries against the restored baseline.
  await db.execute(
    `UPDATE scripts
       SET content_json = $1, characters_meta = $2, updated_at = $3, last_word_count = $4,
           dialog_word_count = $5, direction_block_count = $6
       WHERE id = $7`,
    [
      contentJson,
      charsJson,
      now,
      wordCount,
      runtime.dialogWords,
      runtime.directionBlocks,
      id,
    ],
  );
  await refreshFtsForScript(id);
  if (dropsCharacterNames(parseCharsMeta(prevMeta), parseCharsMeta(charsJson))) {
    characterUsageBus.notifyNamesDropped();
  }
}

export async function archiveScript(id: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "UPDATE scripts SET archived_at = $1 WHERE id = $2",
    [now, id],
  );
}

export async function restoreScript(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE scripts SET archived_at = NULL WHERE id = $1",
    [id],
  );
}

/** Hard-delete a script. Snapshots cascade via the FK; FTS row is
 *  removed explicitly because the virtual table has no FK link. */
export async function purgeScript(id: string): Promise<void> {
  const db = await getDb();
  const metaRows = await db.select<{ characters_meta: string }[]>(
    "SELECT characters_meta FROM scripts WHERE id = $1",
    [id],
  );
  // Sessions of the agent mode outlive the script (trigger in migration
  // 009, atomic with this DELETE); script chats go with it.
  await db.execute("DELETE FROM scripts WHERE id = $1", [id]);
  await deleteScriptFts(id);
  if (parseCharsMeta(metaRows[0]?.characters_meta ?? "[]").length > 0) {
    characterUsageBus.notifyNamesDropped();
  }
}

/** Backfills `dialog_word_count` and `direction_block_count` for all
 *  scripts that still carry the sentinel `-1` from migration 005.
 *  Called once on app start so the overview shows runtimes correctly for
 *  untouched existing scripts immediately - without backfill the label
 *  there would stay hidden until the next save.
 *
 *  Idempotent: scripts that have already been saved no longer pass
 *  the WHERE filter and are not touched.
 *  Read errors on individual content_json blobs don't kill the entire
 *  backfill - the affected row stays on the sentinel and the
 *  next real save normalizes it. */
export async function backfillRuntimeStats(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ id: string; content_json: string }[]>(
    `SELECT id, content_json FROM scripts
     WHERE dialog_word_count = $1 OR direction_block_count = $1`,
    [RUNTIME_STATS_SENTINEL],
  );
  for (const r of rows) {
    try {
      const stats = runtimeStatsFromContent(r.content_json);
      await db.execute(
        `UPDATE scripts
           SET dialog_word_count = $1, direction_block_count = $2
           WHERE id = $3`,
        [stats.dialogWords, stats.directionBlocks, r.id],
      );
    } catch (err) {
      console.warn("[scriptz] runtime-stats backfill failed for", r.id, err);
    }
  }
}

export async function emptyTrash(): Promise<void> {
  const db = await getDb();
  // FTS rows must be removed before the script DELETE because the
  // scripts_fts table has no FK cascade (FTS5 contentless table). Two
  // statements instead of N+1: one DELETE FROM scripts_fts (sub-query
  // against scripts), one DELETE FROM scripts. With 50 archived scripts
  // that used to be 100 round-trips, now it's 2.
  await db.execute(
    "DELETE FROM scripts_fts WHERE script_id IN " +
      "(SELECT id FROM scripts WHERE archived_at IS NOT NULL)",
  );
  const res = await db.execute("DELETE FROM scripts WHERE archived_at IS NOT NULL");
  if (res.rowsAffected > 0) characterUsageBus.notifyNamesDropped();
}

// ---------- internal helpers ----------

/** Lexical state for a brand-new script: a single empty character
 *  block. Mirrors the JSON Rust's `empty_lexical_state` builds. The
 *  exact byte-shape is irrelevant - Lexical re-serialises on the next
 *  save in its own key order. */
function emptyLexicalState(): string {
  return JSON.stringify({
    root: {
      children: [
        {
          type: "scriptz-character",
          version: 1,
          characterName: "",
          direction: null,
          format: "",
          indent: 0,
          children: [],
        },
      ],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });
}

/** Reconciles a stored `characters_meta` blob against `contentJson`,
 *  back-fills unseen names into the app-wide default registry and returns
 *  the serialized result. Shared by content saves and snapshot restore. */
async function reconcileCharsMeta(
  existingMeta: string,
  contentJson: string,
  records: Map<string, ColorRecord>,
  now: number,
): Promise<string> {
  const { chars, newDefaults } = reconcileCharsFromContent(
    parseCharsMeta(existingMeta),
    contentJson,
    records,
  );
  for (const [n, c] of newDefaults) {
    await upsertDefaultColor(n, c, now);
  }
  return serializeCharsMeta(chars);
}

/** Reconcile the per-script character list with the names actually
 *  present in the latest content. Resolution priority per name:
 *    1. App-wide override (`override_color`)
 *    2. Existing per-script entry (sticky - preserves colours from
 *       before the global registry existed)
 *    3. App-wide default (`default_color`)
 *    4. Next palette colour not already claimed in this script
 *
 *  Returns the new chars list plus a list of `[name, color]` pairs
 *  whose `default_color` is still NULL in the registry alongside the
 *  colour they should be back-filled to. Callers must persist these
 *  so the global default converges. Literal port of Rust's
 *  `reconcile_chars_from_content`. */
function reconcileCharsFromContent(
  existing: ScriptCharacter[],
  contentJson: string,
  records: Map<string, ColorRecord>,
): { chars: ScriptCharacter[]; newDefaults: [string, string][] } {
  const names = extractCharacterNames(contentJson);
  const wordsByChar = dialogWordsByCharacter(contentJson);
  let totalDialog = 0;
  for (const v of Object.values(wordsByChar)) totalDialog += v;
  const out: ScriptCharacter[] = [];
  const newDefaults: [string, string][] = [];
  for (const name of names) {
    const upper = name.toUpperCase();
    const rec = records.get(upper);

    let chosen: string;
    const override = rec?.override_color ?? null;
    if (override !== null) {
      chosen = override;
    } else {
      const stuck = existing.find((c) => eqIgnoreAsciiCase(c.name, name));
      if (stuck) {
        chosen = stuck.color;
      } else {
        const fallbackDefault = rec?.default_color ?? null;
        if (fallbackDefault !== null) {
          chosen = fallbackDefault;
        } else {
          const used = new Set<string>();
          for (const c of out) used.add(c.color);
          const usedExisting = new Set<string>();
          for (const c of existing) usedExisting.add(c.color);
          const palette = DEFAULT_PALETTE.find(
            (p) => !used.has(p) && !usedExisting.has(p),
          );
          chosen = palette ?? DEFAULT_PALETTE[0];
        }
      }
    }

    const needsDefault = rec ? rec.default_color === null : true;
    if (
      needsDefault &&
      !newDefaults.some(([n]) => eqIgnoreAsciiCase(n, upper))
    ) {
      newDefaults.push([upper, chosen]);
    }
    const upperName = name.toUpperCase();
    const words = wordsByChar[upperName] ?? 0;
    const share = totalDialog > 0 ? words / totalDialog : 0;
    out.push({ name, color: chosen, share });
  }
  return { chars: out, newDefaults };
}
