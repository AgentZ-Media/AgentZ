// Local SQL implementation of agent persistence. No I/O runs on import.
import { getDb } from "../db";
import { parseItems, type ChatRecord, type LearnedState } from "./chats";
import type { MemoryEntry, MemoryKind, MemorySource, MemoryScope } from "./memory";
import type { AgentStorage } from "./storage";

interface ChatRow {
  id: string;
  kind: string | null;
  script_id: string | null;
  provider: string;
  thread_id: string | null;
  title: string | null;
  folder_id: string | null;
  items_json: string;
  created_at: number;
  updated_at: number;
}

/** Maps a persisted chat row to rendered history with recovered transient UI state. */
function rowToChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    kind: row.kind === "session" ? "session" : "script",
    scriptId: row.script_id,
    provider: row.provider,
    threadId: row.thread_id,
    title: row.title,
    folderId: row.folder_id,
    items: parseItems(row.items_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Loads the newest chat in a script scope, including the null scope for unassigned chats. */
async function latestChat(scriptId: string | null): Promise<ChatRecord | null> {
  const db = await getDb();
  const rows = await db.select<ChatRow[]>(
    `SELECT * FROM agent_chats WHERE script_id IS $1 ORDER BY updated_at DESC LIMIT 1`,
    [scriptId],
  );
  return rows[0] ? rowToChat(rows[0]) : null;
}

/** Loads one chat by id. */
async function getChat(id: string): Promise<ChatRecord | null> {
  const db = await getDb();
  const rows = await db.select<ChatRow[]>(`SELECT * FROM agent_chats WHERE id = $1`, [id]);
  return rows[0] ? rowToChat(rows[0]) : null;
}

/** Upserts a chat. Kind, provider and creation time stay as first saved; the
 *  script link may change (a session handed to a script). */
async function saveChat(chat: ChatRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_chats (id, script_id, provider, thread_id, items_json, created_at, updated_at, kind, title, folder_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT(id) DO UPDATE SET script_id = excluded.script_id, thread_id = excluded.thread_id,
       items_json = excluded.items_json, updated_at = excluded.updated_at,
       title = excluded.title, folder_id = excluded.folder_id`,
    [
      chat.id, chat.scriptId, chat.provider, chat.threadId, JSON.stringify(chat.items),
      chat.createdAt, chat.updatedAt, chat.kind, chat.title, chat.folderId,
    ],
  );
}

/** Deletes a chat; `ideas.source_chat_id` falls back to NULL (migration 010). */
async function deleteChat(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM agent_chats WHERE id = $1`, [id]);
}

/** Sessions with at least one item, newest first; LIKE wildcards in the
 *  query are escaped. */
async function listSessions({ limit, offset, query }: { limit: number; offset: number; query: string }): Promise<ChatRecord[]> {
  const db = await getDb();
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await db.select<ChatRow[]>(
    `SELECT * FROM agent_chats WHERE kind = 'session' AND items_json != '[]'
       AND ($3 = '' OR title LIKE $4 ESCAPE '\\' OR items_json LIKE $4 ESCAPE '\\')
     ORDER BY updated_at DESC, id LIMIT $1 OFFSET $2`,
    [limit, offset, query, pattern],
  );
  return rows.map(rowToChat);
}

/** Reads what was last learned from this script, or null when absent. The
 *  text is null for rows learned before migration 012. */
async function learnedState(scriptId: string): Promise<LearnedState | null> {
  const db = await getDb();
  const rows = await db.select<{ content_hash: string; learned_text: string | null; learned_at: number }[]>(
    "SELECT content_hash, learned_text, learned_at FROM agent_learned WHERE script_id = $1",
    [scriptId],
  );
  const row = rows[0];
  return row ? { hash: row.content_hash, text: row.learned_text, learnedAt: row.learned_at } : null;
}

/** Upserts the learned fingerprint and text and records the current local completion time. */
async function markLearned(scriptId: string, hash: string, text: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_learned (script_id, content_hash, learned_at, learned_text) VALUES ($1, $2, $3, $4)
     ON CONFLICT(script_id) DO UPDATE SET content_hash = excluded.content_hash, learned_at = excluded.learned_at,
       learned_text = excluded.learned_text`,
    [scriptId, hash, Date.now(), text],
  );
}

interface MemoryRow {
  id: string;
  kind: string;
  folder_id: string | null;
  subject: string | null;
  content: string;
  source: string;
  source_script_id: string | null;
  created_at: number;
  updated_at: number;
}

const KINDS: readonly MemoryKind[] = ["global", "folder", "character", "relation"];
const SOURCES: readonly MemorySource[] = ["chat", "script", "user"];

/** Maps a stored fact to the public shape, retaining legacy fallbacks for unknown enum values. */
function rowToEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    kind: (KINDS as readonly string[]).includes(row.kind) ? (row.kind as MemoryKind) : "global",
    folderId: row.folder_id,
    subject: row.subject,
    content: row.content,
    source: (SOURCES as readonly string[]).includes(row.source) ? (row.source as MemorySource) : "chat",
    sourceScriptId: row.source_script_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Lists all facts in scope and creation order for deterministic context assembly. */
async function listMemory(): Promise<MemoryEntry[]> {
  const db = await getDb();
  const rows = await db.select<MemoryRow[]>(
    "SELECT * FROM agent_memory ORDER BY kind, folder_id, subject, created_at",
  );
  return rows.map(rowToEntry);
}

/** Loads a fact by its stable ID without creating a replacement for missing records. */
async function getMemoryEntry(id: string): Promise<MemoryEntry | null> {
  const db = await getDb();
  const rows = await db.select<MemoryRow[]>("SELECT * FROM agent_memory WHERE id = $1", [id]);
  return rows[0] ? rowToEntry(rows[0]) : null;
}

/** Counts an exact scope using null-safe folder and subject comparisons. */
async function countMemoryScope(scope: MemoryScope): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM agent_memory
      WHERE kind = $1 AND folder_id IS $2 AND subject IS $3`,
    [scope.kind, scope.folderId, scope.subject],
  );
  return rows[0]?.n ?? 0;
}

/** Inserts a prevalidated fact with its caller-supplied identity and timestamps. */
async function insertMemory(entry: MemoryEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_memory (id, kind, folder_id, subject, content, source, source_script_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.id, entry.kind, entry.folderId, entry.subject, entry.content, entry.source, entry.sourceScriptId, entry.createdAt, entry.updatedAt],
  );
}

/** Updates only text and modification time; reports whether a matching row existed. */
async function updateMemory(id: string, content: string, updatedAt: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    "UPDATE agent_memory SET content = $1, updated_at = $2 WHERE id = $3",
    [content, updatedAt, id],
  );
  return result.rowsAffected > 0;
}

/** Deletes a fact if present; deleting a missing ID is a no-op. */
async function deleteMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM agent_memory WHERE id = $1", [id]);
}

/** Replaces a fact with its exact prior fields and timestamps for undo. */
async function restoreMemory(entry: MemoryEntry): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO agent_memory (id, kind, folder_id, subject, content, source, source_script_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [entry.id, entry.kind, entry.folderId, entry.subject, entry.content, entry.source, entry.sourceScriptId, entry.createdAt, entry.updatedAt],
  );
}

/** Clears facts, then learned markers in separate statements; chat history is retained. */
async function clearMemory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM agent_memory");
  await db.execute("DELETE FROM agent_learned");
}

export const sqlAgentStorage: AgentStorage = {
  latestChat, getChat, saveChat, deleteChat, listSessions, learnedState, markLearned,
  listMemory, getMemoryEntry, countMemoryScope, insertMemory,
  updateMemory, deleteMemory, restoreMemory, clearMemory,
};
