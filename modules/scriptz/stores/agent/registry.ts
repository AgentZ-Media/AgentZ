import { createSignal } from "solid-js";
import type { ChatSession } from "./types";

// ---------------------------------------------------------------------------
// Live chats: every chat row has at most one live object, shared by the
// script panel, the agent mode and learning.
// ---------------------------------------------------------------------------

/** Live chats by script (panel) and by chat id (agent mode). */
export const byScript = new Map<string, ChatSession>();
export const byChat = new Map<string, ChatSession>();
/** Script chats being resolved, so two callers get the same object. */
export const pendingScripts = new Map<string, Promise<ChatSession>>();

/** Bumped when a chat joins or leaves the maps: views that ask "is any
 *  chat running?" must also see chats created after they first looked. */
const [chatsVersion, setChatsVersion] = createSignal(0);
export const chatsChanged = () => setChatsVersion((v) => v + 1);

export function liveChats(): ChatSession[] {
  chatsVersion();
  return [...new Set([...byScript.values(), ...byChat.values()])];
}

/** Removes a chat from both maps (after `discard()`). */
export function unregisterChat(chat: ChatSession): void {
  for (const [key, value] of byScript) if (value === chat) byScript.delete(key);
  for (const [key, value] of byChat) if (value === chat) byChat.delete(key);
  chatsChanged();
}

export function clearLiveChats(): void {
  byScript.clear();
  byChat.clear();
  pendingScripts.clear();
  chatsChanged();
}
