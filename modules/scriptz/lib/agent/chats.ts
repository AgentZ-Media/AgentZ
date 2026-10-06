// Chat items and their persistence (table `agent_chats`, migrations 008 and
// 010). A script chat belongs to one script (the newest row); "new chat"
// starts a fresh row. A session (kind 'session') starts in the agent mode
// without a script and may later be handed to a script it created. Items
// are stored as rendered UI state, never as raw provider frames.
//
// Storage goes through `ScriptzStorage.agent` (SQL in `sqlStorage.ts`); the
// item normalization and session summaries here are adapter-neutral.

import { getStorageAdapter } from "../storage";
import { collectDrafts } from "./drafts";
import type { Claim, Proposal } from "./proposals";
import type { MemoryEntry } from "./memory";

export type ToolStatus = "running" | "done" | "failed";

/** One idea card as the agent proposed it. */
export interface IdeaCard {
  title: string;
  premise: string;
  hook: string;
  characters: string[];
  /** Estimated runtime in seconds, if the agent gave one. */
  seconds: number | null;
}

export interface SavedIdeaRef {
  ideaId: string;
  title: string;
  /** Card number (1-based) on the board it came from, if any. */
  number: number | null;
}

export type ChatItem =
  | { kind: "user"; id: string; text: string; quote?: string; job?: string }
  | { kind: "assistant"; id: string; text: string; streaming?: boolean; commentary?: boolean }
  | { kind: "thinking"; id: string; text: string; done: boolean }
  | { kind: "tool"; id: string; tool: string; args: Record<string, unknown>; status: ToolStatus }
  | { kind: "search"; id: string; query: string; status: ToolStatus }
  | { kind: "proposal"; id: string; proposal: Proposal; applied: number | null }
  | { kind: "claims"; id: string; claims: Claim[]; applied: number[] }
  | { kind: "memory"; id: string; action: "added" | "updated" | "removed"; entry: MemoryEntry; previous?: MemoryEntry; undone?: boolean }
  | { kind: "ideas"; id: string; folderId: string | null; ideas: IdeaCard[]; picked: number[]; savedIds: (string | null)[] }
  | { kind: "ideas-saved"; id: string; folderId: string | null; saved: SavedIdeaRef[]; undone?: boolean }
  | { kind: "replies"; id: string; replies: string[] }
  | { kind: "handoff"; id: string; scriptId: string; title: string; slug: string; versionId: string; folderId: string | null; at: number }
  | { kind: "draft-discarded"; id: string; slug: string; versionId: string }
  | { kind: "blocked"; id: string; what: string }
  | { kind: "error"; id: string; message: string }
  | { kind: "interrupted"; id: string };

export type ChatKind = "script" | "session";

export interface ChatRecord {
  id: string;
  kind: ChatKind;
  scriptId: string | null;
  provider: string;
  threadId: string | null;
  /** Session name (from the first message); null for script chats. */
  title: string | null;
  /** Folder a session works in; null = none chosen. */
  folderId: string | null;
  items: ChatItem[];
  createdAt: number;
  updatedAt: number;
}

const KNOWN_KINDS = new Set([
  "user", "assistant", "thinking", "tool", "search", "proposal", "claims", "memory",
  "ideas", "ideas-saved", "replies", "handoff", "draft-discarded",
  "blocked", "error", "interrupted",
]);

/** Restores stored items: unknown kinds are dropped and transient running
 *  states end, so a crash mid-turn leaves no spinners. Every adapter uses it. */
export function parseItems(raw: string): ChatItem[] {
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

/** Newest chat of a script (sessions handed to it included), or of the
 *  unassigned scope when null. */
export async function latestChat(scriptId: string | null): Promise<ChatRecord | null> {
  return getStorageAdapter().agent.latestChat(scriptId);
}

export async function getChat(id: string): Promise<ChatRecord | null> {
  return getStorageAdapter().agent.getChat(id);
}

/** Persists rendered chat state through the active adapter; callers coordinate flush ordering. */
export async function saveChat(chat: ChatRecord): Promise<void> {
  return getStorageAdapter().agent.saveChat(chat);
}

export async function deleteChat(id: string): Promise<void> {
  return getStorageAdapter().agent.deleteChat(id);
}

/** A session as the start screen and the session menu list it. */
export interface SessionSummary {
  id: string;
  title: string | null;
  folderId: string | null;
  scriptId: string | null;
  updatedAt: number;
  /** Drafts that are neither finished nor discarded in their latest version. */
  openDrafts: number;
  /** Title of the newest draft, if any. */
  lastDraft: string | null;
  /** Number of the newest draft's latest version (1-based). */
  lastDraftVersion: number;
  /** Scripts created from this session. */
  finished: number;
  /** Ideas saved in this session. */
  savedIdeas: number;
}

/** Open, finished and discarded drafts of a chat, from its items. */
export function draftStates(items: readonly ChatItem[]) {
  const drafts = collectDrafts(items);
  const finished = new Map<string, string>();
  const discarded = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "handoff") finished.set(item.slug, item.versionId);
    if (item.kind === "draft-discarded") discarded.set(item.slug, item.versionId);
  }
  return drafts.map((draft) => {
    const latest = draft.versions[draft.versions.length - 1];
    const state: "open" | "finished" | "discarded" = finished.get(draft.slug) === latest.id
      ? "finished"
      : discarded.get(draft.slug) === latest.id ? "discarded" : "open";
    return { draft, latest, state };
  });
}

export function summarizeSession(chat: Pick<ChatRecord, "id" | "title" | "folderId" | "scriptId" | "updatedAt" | "items">): SessionSummary {
  const states = draftStates(chat.items);
  const last = states[states.length - 1];
  let savedIdeas = 0;
  for (const item of chat.items) {
    if (item.kind === "ideas-saved" && !item.undone) savedIdeas += item.saved.length;
  }
  return {
    id: chat.id,
    title: chat.title,
    folderId: chat.folderId,
    scriptId: chat.scriptId,
    updatedAt: chat.updatedAt,
    openDrafts: states.filter((s) => s.state === "open").length,
    lastDraft: last ? last.latest.title || null : null,
    lastDraftVersion: last ? last.draft.versions.length : 0,
    finished: chat.items.filter((i) => i.kind === "handoff").length,
    savedIdeas,
  };
}

/** Sessions with at least one message, newest first. `query` searches the
 *  title and the conversation (draft titles included); `offset` pages. */
export async function listSessions(limit = 40, offset = 0, query = ""): Promise<SessionSummary[]> {
  const chats = await getStorageAdapter().agent.listSessions({ limit, offset, query: query.trim() });
  return chats.map(summarizeSession);
}

/** What the agent last learned from a script. */
export interface LearnedState {
  hash: string;
  /** Learned text (`learnText`), null for rows from before migration 012. */
  text: string | null;
  learnedAt: number;
}

/** Returns what was last learned from a script, or null when it has not been learned. */
export async function learnedState(scriptId: string): Promise<LearnedState | null> {
  return getStorageAdapter().agent.learnedState(scriptId);
}

/** Records hash and text only after the caller has completed a learning turn. */
export async function markLearned(scriptId: string, hash: string, text: string): Promise<void> {
  return getStorageAdapter().agent.markLearned(scriptId, hash, text);
}
