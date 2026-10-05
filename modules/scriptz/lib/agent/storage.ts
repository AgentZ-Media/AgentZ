import type { ChatRecord } from "./chats";
import type { MemoryEntry, MemoryScope } from "./memory";

/** Typed persistence boundary for user-created agent data. The public memory
 * facade owns validation and UI notifications; adapters only store records.
 * Settings and provider credentials deliberately do not belong here. */
export interface AgentStorage {
  latestChat(scriptId: string | null): Promise<ChatRecord | null>;
  saveChat(chat: ChatRecord): Promise<void>;
  learnedHash(scriptId: string): Promise<string | null>;
  markLearned(scriptId: string, hash: string): Promise<void>;
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
