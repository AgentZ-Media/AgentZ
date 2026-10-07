import type { LocalChangeBatch, RemoteChange, SyncAdapter, SyncChange, SyncContext } from "@agentz/kit/account";
import { getKvStore } from "@agentz/kit/platform";
import { getDb } from "../db";
import { deleteScriptFts, refreshFtsForScript } from "../fts";
import { CONTENT_ENTITIES, type ContentEntity } from "../localChanges/entities";
import { sqlLocalChanges } from "../localChanges/sql";
import format from "./format.json";

// ScriptZ data for the Kit sync engine. Every content table of the change feed
// syncs as one entity; the daily word log syncs per device ("daily_words").
// Device-local details stay local: Codex thread IDs and the unedited welcome
// script every installation seeds on its own.

type Row = Record<string, string | number | null>;

/** Referenced tables first (writing), so foreign keys always resolve. */
export const SYNC_ENTITIES = [
  "folders", "scripts", "agent_chats", "ideas", "snapshots",
  "agent_memory", "agent_learned", "character_colors", "daily_words",
] as const;

/** Product settings worth having on every device. Appearance, models and
 *  the Codex installation stay per device. */
export const SYNCED_SETTINGS = [
  "script_stages", "length_min_default_sec", "length_max_default_sec", "dialog_wpm",
  "highlighting_default", "export_title_page_default", "focus_mode_default", "focus_typewriter",
  "quick_mode_auto_enable", "show_writing_stats", "open_scripts_in_panel", "close_finished_scripts",
  "prune_unused_characters",
  "agent.name", "agent.look", "agent.traits", "agent.instructions", "agent.user_name",
  "agent.learn_scripts", "agent.learn_chat", "agent.learn_stage",
] as const;

const WELCOME_ID_KEY = "welcome_script_id_v1";
const WORDS = "daily_words";

/** Columns that stay on the device although their table syncs. */
const LOCAL_COLUMNS: Partial<Record<ContentEntity, readonly string[]>> = { agent_chats: ["thread_id"] };

/** Fields of every synced record. format.json records them; its test fails on any change (docs/cloud-sync.md). */
export const SYNC_FIELDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(SYNC_ENTITIES.map((entity) => [
  entity,
  entity === WORDS
    ? ["date", "words_added"]
    : CONTENT_ENTITIES[entity].columns.filter((column) => !(LOCAL_COLUMNS[entity] ?? []).includes(column)),
]));

/** Sync format of this version (format.json, docs/cloud-sync.md "Versionen und Kompatibilität"). */
export const SYNC_FORMAT = { reads: format.reads, writes: format.writes } as const;

/** Foreign keys per entity. `required`: without the parent the row is useless. */
const REFS: Partial<Record<ContentEntity, { column: string; table: ContentEntity; required: (row: Row) => boolean }[]>> = {
  scripts: [{ column: "folder_id", table: "folders", required: () => false }],
  agent_chats: [
    { column: "script_id", table: "scripts", required: (row) => row.kind === "script" },
    { column: "folder_id", table: "folders", required: () => false },
  ],
  ideas: [
    { column: "script_id", table: "scripts", required: () => false },
    { column: "folder_id", table: "folders", required: () => false },
    { column: "source_chat_id", table: "agent_chats", required: () => false },
  ],
  snapshots: [{ column: "script_id", table: "scripts", required: () => true }],
  agent_memory: [{ column: "folder_id", table: "folders", required: () => true }],
  agent_learned: [{ column: "script_id", table: "scripts", required: () => true }],
};

const isContent = (entity: string): entity is ContentEntity => Object.hasOwn(CONTENT_ENTITIES, entity);
const keyColumn = (entity: ContentEntity) => CONTENT_ENTITIES[entity].key;
const keyMatch = (entity: ContentEntity) => entity === "character_colors" ? "upper(name) = $1" : `${keyColumn(entity)} = $1`;

/** Local row -> synced record; null leaves the row out of the sync. */
function outgoing(entity: ContentEntity, row: Row, welcomeId: string | null): Row | null {
  if (entity === "scripts" && row.id === welcomeId && row.created_at === row.updated_at) return null;
  if (entity === "agent_chats") {
    const { thread_id: _local, ...rest } = row;
    return rest;
  }
  return row;
}

export interface AppliedSummary {
  entities: Set<string>;
  /** Scripts whose stored text changed (open editors reload them). */
  scripts: Set<string>;
  chats: Set<string>;
}

export interface ScriptzSyncHooks {
  /** UI refresh after cloud records were written. */
  applied(summary: AppliedSummary): void;
  /** Settings changed by another device. */
  settingsChanged(keys: string[]): void | Promise<void>;
  /** Title suffix of a conflict copy, in the UI language. */
  copySuffix(): string;
}

export function createScriptzSyncAdapter(hooks: ScriptzSyncHooks): SyncAdapter {
  const welcomeId = () => getKvStore().getAppState(WELCOME_ID_KEY).catch(() => null);

  async function exists(table: ContentEntity, id: string | number | null): Promise<boolean> {
    if (id === null || id === undefined) return true;
    const db = await getDb();
    const rows = await db.select<{ n: number }[]>(`SELECT 1 AS n FROM ${table} WHERE ${keyColumn(table)} = $1 LIMIT 1`, [id]);
    return rows.length > 0;
  }

  async function storedContent(id: string): Promise<string | null> {
    const db = await getDb();
    const rows = await db.select<{ content_json: string }[]>("SELECT content_json FROM scripts WHERE id = $1", [id]);
    return rows[0]?.content_json ?? null;
  }

  async function readRow(entity: ContentEntity, id: string): Promise<Row | null> {
    const columns = CONTENT_ENTITIES[entity].columns;
    const db = await getDb();
    const fields = columns.map((column) => `'${column}', ${column}`).join(", ");
    const rows = await db.select<{ record: string }[]>(
      `SELECT json_object(${fields}) AS record FROM ${entity} WHERE ${keyMatch(entity)} LIMIT 1`, [id],
    );
    return rows[0] ? JSON.parse(rows[0].record) as Row : null;
  }

  /** Writes the record's columns. A column the record lacks (written by an
   *  older version) keeps its local value, or its default on insert. */
  async function upsert(entity: ContentEntity, row: Row): Promise<void> {
    const key = keyColumn(entity);
    const columns = CONTENT_ENTITIES[entity].columns
      .filter((column) => !(LOCAL_COLUMNS[entity] ?? []).includes(column) && (column === key || Object.hasOwn(row, column)));
    const values = columns.map((column) => row[column] ?? null);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const updates = columns.filter((column) => column !== key).map((column) => `${column} = excluded.${column}`);
    // A chat continued elsewhere no longer matches the local Codex thread.
    if (entity === "agent_chats" && Object.hasOwn(row, "items_json")) {
      updates.push("thread_id = CASE WHEN agent_chats.items_json IS excluded.items_json THEN agent_chats.thread_id ELSE NULL END");
    }
    const db = await getDb();
    await db.execute(
      `INSERT INTO ${entity} (${columns.join(", ")}) VALUES (${placeholders})
       ON CONFLICT(${key}) DO ${updates.length > 0 ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"}`,
      values,
    );
  }

  async function remove(entity: ContentEntity, id: string): Promise<void> {
    const db = await getDb();
    if (entity === "scripts") await deleteScriptFts(id);
    await db.execute(`DELETE FROM ${entity} WHERE ${keyMatch(entity)}`, [id]);
  }

  async function applyWords(change: RemoteChange, context: SyncContext): Promise<void> {
    const split = change.id.lastIndexOf(":");
    const device = change.id.slice(0, split);
    const date = change.id.slice(split + 1);
    // This device's own counter lives in daily_word_log and is authoritative.
    if (!device || device === context.deviceId) return;
    const db = await getDb();
    if (change.record === null) {
      await db.execute("DELETE FROM daily_word_log_remote WHERE device_id = $1 AND date = $2", [device, date]);
      return;
    }
    const words = Number((change.record as Row).words_added) || 0;
    await db.execute(
      `INSERT INTO daily_word_log_remote (device_id, date, words_added) VALUES ($1, $2, $3)
       ON CONFLICT(device_id, date) DO UPDATE SET words_added = excluded.words_added`,
      [device, date, words],
    );
  }

  return {
    entities: SYNC_ENTITIES,
    format: SYNC_FORMAT,
    fields: SYNC_FIELDS,

    async localCursor() {
      const db = await getDb();
      const rows = await db.select<{ seq: number }[]>("SELECT COALESCE(MAX(sequence), 0) AS seq FROM local_changes");
      return rows[0]?.seq ?? 0;
    },

    async readChanges(after, limit, context): Promise<LocalChangeBatch> {
      const page = await sqlLocalChanges.readChanges({ afterSequence: after, limit });
      const welcome = await welcomeId();
      const changes: SyncChange[] = [];
      for (const change of page.changes) {
        if (change.entity === "daily_word_log") {
          const date = change.entityId;
          changes.push({
            entity: WORDS, id: `${context.deviceId}:${date}`,
            record: change.record ? { date, words_added: change.record.words_added } : null,
          });
          continue;
        }
        if (change.record === null) { changes.push({ entity: change.entity, id: change.entityId, record: null }); continue; }
        const record = outgoing(change.entity, change.record as Row, welcome);
        if (record) changes.push({ entity: change.entity, id: change.entityId, record });
      }
      return { changes, nextCursor: page.nextCursor, more: page.changes.length === limit };
    },

    async read(entity, id, context) {
      if (entity === WORDS) {
        const split = id.lastIndexOf(":");
        const device = id.slice(0, split);
        const date = id.slice(split + 1);
        const db = await getDb();
        const rows = device === context.deviceId
          ? await db.select<{ words_added: number }[]>("SELECT words_added FROM daily_word_log WHERE date = $1", [date])
          : await db.select<{ words_added: number }[]>("SELECT words_added FROM daily_word_log_remote WHERE device_id = $1 AND date = $2", [device, date]);
        return rows[0] ? { date, words_added: rows[0].words_added } : null;
      }
      if (!isContent(entity)) return null;
      const row = await readRow(entity, id);
      return row ? outgoing(entity, row, null) : null;
    },

    async apply(changes, context) {
      const waiting: RemoteChange[] = [];
      const summary: AppliedSummary = { entities: new Set(), scripts: new Set(), chats: new Set() };
      for (const change of changes) {
        if (change.entity === WORDS) {
          await applyWords(change, context);
          summary.entities.add(WORDS);
          continue;
        }
        if (!isContent(change.entity)) continue;
        const entity = change.entity;
        if (change.record === null) {
          await remove(entity, change.id);
        } else {
          const row = { ...(change.record as Row) };
          let skip = false;
          for (const ref of REFS[entity] ?? []) {
            if (await exists(ref.table, row[ref.column])) continue;
            if (!context.force) { waiting.push(change); skip = true; break; }
            // The parent never arrived (deleted meanwhile): keep what still makes sense.
            if (ref.required(row)) { skip = true; break; }
            row[ref.column] = null;
          }
          if (skip) continue;
          const before = entity === "scripts" ? await storedContent(change.id) : null;
          await upsert(entity, row);
          if (entity === "scripts") {
            await refreshFtsForScript(change.id);
            if (before !== row.content_json) summary.scripts.add(change.id);
          }
        }
        summary.entities.add(entity);
        if (entity === "agent_chats") summary.chats.add(change.id);
      }
      if (summary.entities.size > 0) hooks.applied(summary);
      return waiting;
    },

    async keepLocalCopy(entity, _id, record) {
      if (entity !== "scripts" && entity !== "ideas") return;
      const row = { ...(record as Row) };
      const now = Date.now();
      row.id = crypto.randomUUID();
      row.title = `${row.title ?? ""} (${hooks.copySuffix()})`.trim();
      row.created_at = now;
      if (entity === "scripts") row.updated_at = now;
      for (const ref of REFS[entity] ?? []) {
        if (!(await exists(ref.table, row[ref.column]))) row[ref.column] = null;
      }
      await upsert(entity, row);
      if (entity === "scripts") await refreshFtsForScript(row.id);
      hooks.applied({ entities: new Set([entity]), scripts: new Set(), chats: new Set() });
    },

    settings: {
      keys: SYNCED_SETTINGS,
      changed: (keys) => hooks.settingsChanged(keys),
    },
  };
}
