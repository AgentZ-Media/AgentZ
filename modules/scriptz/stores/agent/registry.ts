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

/** Order of last use (panel, agent mode, new session), for unloading the
 *  least recently used idle chats. */
const lastUse = new Map<ChatSession, number>();
let useCount = 0;

export function touchChat(chat: ChatSession): void {
  lastUse.set(chat, ++useCount);
}

/** 0 for a chat never asked for by a view (e.g. loaded by its own row). */
export function lastUsed(chat: ChatSession): number {
  return lastUse.get(chat) ?? 0;
}

/** Drops use marks of chats that left the maps another way (failed load). */
export function pruneLastUse(): void {
  const live = new Set(liveChats());
  for (const chat of [...lastUse.keys()]) if (!live.has(chat)) lastUse.delete(chat);
}

export function liveChats(): ChatSession[] {
  chatsVersion();
  return [...new Set([...byScript.values(), ...byChat.values()])];
}

/** Removes a chat from both maps (after `discard()`). */
export function unregisterChat(chat: ChatSession): void {
  for (const [key, value] of byScript) if (value === chat) byScript.delete(key);
  for (const [key, value] of byChat) if (value === chat) byChat.delete(key);
  lastUse.delete(chat);
  chatsChanged();
}

export function clearLiveChats(): void {
  byScript.clear();
  byChat.clear();
  pendingScripts.clear();
  lastUse.clear();
  chatsChanged();
}
