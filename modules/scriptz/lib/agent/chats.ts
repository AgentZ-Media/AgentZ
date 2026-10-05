// Chat items and their persistence (table `agent_chats`, migration 008).
// One chat per script (the newest row); "new chat" starts a fresh row. Items
// are stored as rendered UI state, never as raw provider frames.

import { getDb } from "../db";
import type { Claim, Proposal } from "./proposals";
import type { MemoryEntry } from "./memory";

export type ToolStatus = "running" | "done" | "failed";

export type ChatItem =
  | { kind: "user"; id: string; text: string; quote?: string }
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; commentary?: boolean }
  | { kind: "thinking"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>; status: ToolStatus }
  | { kind: "search"; id: string; query: string; status: ToolStatus }
  | { kind: "proposal"; id: string; proposal: Proposal; applied: number | null }
  | { kind: "claims"; id: string; claims: Claim[]; applied: number[] }
  | { kind: "memory"; id: string; action: "added" | "updated" | "removed"; entry: MemoryEntry; previous?: MemoryEntry; undone?: boolean }
  | { kind: "blocked"; id: string; what: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "interrupted"; id: string };

export interface ChatRecord {
  id: string;
  scriptId: string | null;
  provider: string;
  threadId: string | null;
  items: ChatItem[];
  createdAt: number;
  updatedAt: number;
}

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

export async function latestChat(scriptId: string | null): Promise<ChatRecord | null> {
  const db = await getDb();
  const rows = await db.select<ChatRow[]>(
    `SELECT * FROM agent_chats WHERE script_id IS $1 ORDER BY updated_at DESC LIMIT 1`,
    [scriptId],
  );
  return rows[0] ? rowToChat(rows[0]) : null;
}

export async function saveChat(chat: ChatRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_chats (id, script_id, provider, thread_id, items_json, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET thread_id = excluded.thread_id, items_json = excluded.items_json, updated_at = excluded.updated_at`,
    [chat.id, chat.scriptId, chat.provider, chat.threadId, JSON.stringify(chat.items), chat.createdAt, chat.updatedAt],
  );
}

export async function learnedHash(scriptId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ content_hash: string }[]>("SELECT content_hash FROM agent_learned WHERE script_id = $1", [scriptId]);
  return rows[0]?.content_hash ?? null;
}

export async function markLearned(scriptId: string, hash: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO agent_learned (script_id, content_hash, learned_at) VALUES ($1, $2, $3)
     ON CONFLICT(script_id) DO UPDATE SET content_hash = excluded.content_hash, learned_at = excluded.learned_at`,
    [scriptId, hash, Date.now()],
  );
}
