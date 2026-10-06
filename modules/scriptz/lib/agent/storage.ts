import type { ChatRecord, LearnedState } from "./chats";
import type { MemoryEntry, MemoryScope } from "./memory";

/** Typed persistence boundary for user-created agent data. The public memory
 * facade owns validation and UI notifications; adapters only store records.
 * Settings and provider credentials deliberately do not belong here. */
export interface AgentStorage {
  /** Newest chat whose script is `scriptId` (null = unassigned), any kind. */
  latestChat(scriptId: string | null): Promise<ChatRecord | null>;
  getChat(id: string): Promise<ChatRecord | null>;
  /** Upserts a chat. `kind`, `provider` and `createdAt` are fixed by the
   *  first save; everything else follows the record. */
  saveChat(chat: ChatRecord): Promise<void>;
  /** Deletes a chat; ideas saved from it keep existing without the link. */
  deleteChat(id: string): Promise<void>;
  /** Sessions (kind 'session') with at least one item, newest first. A
   *  non-empty `query` matches the title or the stored conversation. */
  listSessions(options: { limit: number; offset: number; query: string }): Promise<ChatRecord[]>;
  learnedState(scriptId: string): Promise<LearnedState | null>;
  markLearned(scriptId: string, hash: string, text: string): Promise<void>;
  listMemory(): Promise<MemoryEntry[]>;
  getMemoryEntry(id: string): Promise<MemoryEntry | null>;
  countMemoryScope(scope: MemoryScope): Promise<number>;
  insertMemory(entry: MemoryEntry): Promise<void>;
  /** Returns false when the record does not exist. */
  updateMemory(id: string, content: string, updatedAt: number): Promise<boolean>;
  deleteMemory(id: string): Promise<void>;
  /** Restores all original fields, including timestamps, for undo. */
  restoreMemory(entry: MemoryEntry): Promise<void>;
  /** Clears memory and learned markers together, leaving chat history intact. */
  clearMemory(): Promise<void>;
}
