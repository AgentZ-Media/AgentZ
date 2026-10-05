// Chat items and their persistence (table `agent_chats`, migration 008).
// One chat per script (the newest row); "new chat" starts a fresh row. Items
// are stored as rendered UI state, never as raw provider frames.

import { getStorageAdapter } from "../storage";
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

/** Loads the most recently updated chat for a script, or the unassigned scope when null. */
export async function latestChat(scriptId: string | null): Promise<ChatRecord | null> {
  return getStorageAdapter().agent.latestChat(scriptId);
}

/** Persists rendered chat state through the active adapter; callers coordinate flush ordering. */
export async function saveChat(chat: ChatRecord): Promise<void> {
  return getStorageAdapter().agent.saveChat(chat);
}

/** Returns the last learned content hash, or null when the script has not been learned. */
export async function learnedHash(scriptId: string): Promise<string | null> {
  return getStorageAdapter().agent.learnedHash(scriptId);
}

/** Records the content hash only after the caller has completed a learning turn. */
export async function markLearned(scriptId: string, hash: string): Promise<void> {
  return getStorageAdapter().agent.markLearned(scriptId, hash);
}
