import type { Accessor } from "solid-js";
import type { ChatItem, ChatKind } from "../../lib/agent/chats";

// ---------------------------------------------------------------------------
// Chats: one per script (panel) or per session (agent mode). A session can
// be handed to a script it created; it is then the script's chat as well
// and the same live object serves both views.
// ---------------------------------------------------------------------------

export interface ChatSession {
  /** Id of the chat row (stable until "New chat" in a script panel). */
  chatId(): string;
  kind(): ChatKind;
  /** The script the chat belongs to; null for a session not handed over. */
  scriptId(): string | null;
  title(): string | null;
  folderId(): string | null;
  setFolder(folderId: string | null): void;
  items: ChatItem[];
  running: Accessor<boolean>;
  ready: Accessor<boolean>;
  /** `options.instruction` goes to the model instead of `text`; the chat
   *  shows `text` (a job's short label). `options.hint` is context for the
   *  model only (e.g. an idea id), never shown. */
  send(text: string, quote?: ChatQuote, options?: SendOptions): Promise<void>;
  stop(): Promise<void>;
  /** "New chat": ends the thread and stores an empty chat, so the old
   *  conversation does not come back after a restart. */
  reset(): Promise<void>;
  /** Writes a pending save now; rejects if the last write failed. */
  flush(): Promise<void>;
  /** Drops the provider thread but keeps the visible chat; the next message
   *  resumes the saved thread on a fresh connection. */
  release(): void;
  applyOption(itemId: string, index: number): boolean;
  applyFix(itemId: string, index: number): boolean;
  undoMemory(itemId: string): Promise<void>;
  /** Adds items from outside a turn (e.g. background learning). */
  append(items: ChatItem[]): void;
  /** Picks or unpicks an idea card. */
  togglePick(itemId: string, index: number): void;
  /** Saves idea cards of a board to the idea list (button, not the model). */
  saveIdeas(itemId: string, indices: number[]): Promise<number>;
  undoSavedIdeas(itemId: string): Promise<void>;
  discardDraft(slug: string, versionId: string): void;
  /** Records that a draft version became a script. */
  recordHandoff(entry: Omit<Extract<ChatItem, { kind: "handoff" }>, "kind" | "id" | "at">): void;
  /** Moves the chat to a script (it becomes that script's chat) and takes
   *  over the script's folder. */
  attachToScript(scriptId: string, folderId: string | null): Promise<void>;
  /** The script was deleted for good: a session goes on without it. */
  detachFromScript(): void;
  /** The session's folder was deleted. */
  forgetFolder(): void;
  /** Stops for good before the chat row is deleted: no turn, timer or
   *  pending write may store it again. */
  discard(): Promise<void>;
}

export interface SendOptions {
  /** Sent to the model instead of the visible text (fixed jobs). */
  instruction?: string;
  /** Job id stored on the user item (lib/agent/jobs.ts). */
  job?: string;
  /** Context for the model only, never shown. */
  hint?: string;
}

export interface ChatQuote {
  text: string;
  /** Block range in the open script; absent for a quote from a draft. */
  from?: number;
  to?: number;
  /** Draft the quote comes from. */
  draft?: string;
}
