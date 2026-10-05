// Local SQL implementation of agent persistence. No I/O runs on import.
import { getDb } from "../db";
import type { ChatItem, ChatRecord } from "./chats";
import type { MemoryEntry, MemoryKind, MemorySource, MemoryScope } from "./memory";
import type { AgentStorage } from "./storage";

interface ChatRow {
  id: string;
  script_id: string | null;
  provider: string;
  thread_id: string | null;
  items_json: string;
  created_at: number;
  updated_at: number;
}

const KNOWN_KINDS = new Set(["user", "assistant", "thinking", "tool", "search", "proposal", "claims", "memory", "blocked", "error", "interrupted"]);

/** Recovers known chat item kinds and clears transient running states after a restart. */
function parseItems(raw: string): ChatItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ChatItem =>
      typeof item === "object" && item !== null && KNOWN_KINDS.has((item as { kind?: string }).kind ?? ""),
    ).map((item) => {
      // A crash mid-turn must not leave spinners behind.
      if (item.kind === "assistant") return { ...item, streaming: false };
      if (item.kind === "thinking") return { ...item, done: true };
      if ((item.kind === "tool" || item.kind === "search") && item.status === "running") return { ...item, status: "done" as const };
      return item;
    });
  } catch {
    return [];
  }
}

/** Maps a persisted chat row to rendered history with recovered transient UI state. */
function rowToChat(row: ChatRow): ChatRecord {
  return {
    id: row.id,
    scriptId: row.script_id,
    provider: row.provider,
    threadId: row.thread_id,
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

/** Upserts chat content while retaining the original script, provider and creation time. */
async function saveChat(chat: ChatRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_chats (id, script_id, provider, thread_id, items_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, items_json = excluded.items_json, updated_at = excluded.updated_at`,
    [chat.id, chat.scriptId, chat.provider, chat.threadId, JSON.stringify(chat.items), chat.createdAt, chat.updatedAt],
  );
}

/** Reads the content fingerprint last learned for this script, or null when absent. */
async function learnedHash(scriptId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ content_hash: string }[]>("SELECT content_hash FROM agent_learned WHERE script_id = $1", [scriptId]);
  return rows[0]?.content_hash ?? null;
}

/** Upserts the learned fingerprint and records the current local completion time. */
async function markLearned(scriptId: string, hash: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_learned (script_id, content_hash, learned_at) VALUES ($1, $2, $3)
     ON CONFLICT(script_id) DO UPDATE SET content_hash = excluded.content_hash, learned_at = excluded.learned_at`,
    [scriptId, hash, Date.now()],
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
  latestChat, saveChat, learnedHash, markLearned,
  listMemory, getMemoryEntry, countMemoryScope, insertMemory,
  updateMemory, deleteMemory, restoreMemory, clearMemory,
};
