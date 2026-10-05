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

export async function latestChat(scriptId: string | null): Promise<ChatRecord | null> {
  return getStorageAdapter().agent.latestChat(scriptId);
}

export async function saveChat(chat: ChatRecord): Promise<void> {
  return getStorageAdapter().agent.saveChat(chat);
}

export async function learnedHash(scriptId: string): Promise<string | null> {
  return getStorageAdapter().agent.learnedHash(scriptId);
}

export async function markLearned(scriptId: string, hash: string): Promise<void> {
  return getStorageAdapter().agent.markLearned(scriptId, hash);
}
