import { latestChat, deleteChat } from "../lib/agent/chats";
import { agentSettings } from "./agentSettings";
import { hasAgentHost, hostedAccess, models, modelsLoading, openRouterKeyHint, refreshHostedAccess, refreshModels, refreshStatus, resolveModel, setOpenRouterKey, status } from "./agent/provider";
import { createChat } from "./agent/chat";
import { clearMemory } from "../lib/agent/memory";
import { bootstrap, cancelBootstrap, existingScriptCount, learnedVersion, learning, resetLearnChecks, scheduleLearning, startBootstrap, waiting } from "./agent/learning";
import { byChat, byScript, chatsChanged, lastUsed, liveChats, pendingScripts, pruneLastUse, touchChat, unregisterChat } from "./agent/registry";
import { refreshSessionList, sessionList } from "./agent/sessionList";
import type { ChatSession } from "./agent/types";
import { agentUi } from "./agentUi";
import { navStore } from "./nav";

// The agent store is split by concern under `stores/agent/`: provider and
// status, instructions, one live chat, item reducer, live chat registry,
// session list, learning and runtime. This file is its public face.

export type { AgentStatus } from "./agent/provider";
export { currentPace } from "./agent/instructions";
export type { ChatSession, SendOptions, ChatQuote } from "./agent/types";
export { sessionTitleFrom } from "./agent/chat";
export type { BootstrapState, LearnRef } from "./agent/learning";
export { startAgentRuntime } from "./agent/runtime";

/** Idle chats kept loaded (parsed items and an open provider thread each);
 *  the least recently used beyond this are unloaded and load again from
 *  storage when asked for. */
const IDLE_CHATS_MAX = 10;
let evictTimer: ReturnType<typeof setTimeout> | null = null;
let evicting = false;

/** A chat on screen, running, saving or being learned into stays loaded. */
function inUse(chat: ChatSession): boolean {
  if (!chat.idle()) return true;
  if (chat.chatId() === navStore.activeAgentChatId()) return true;
  const scriptId = chat.scriptId();
  return !!scriptId && (agentUi.chatOpen(scriptId) || navStore.activeScriptId() === scriptId || learning()?.id === scriptId);
}

function scheduleEviction(): void {
  if (evictTimer) return;
  evictTimer = setTimeout(() => {
    evictTimer = null;
    void evictIdleChats().catch((error: unknown) => console.warn("[agent] unloading chats failed", error));
  }, 1000);
}

async function evictIdleChats(): Promise<void> {
  if (evicting) return;
  evicting = true;
  try {
    pruneLastUse();
    const idle = liveChats().filter((chat) => !inUse(chat)).sort((a, b) => lastUsed(a) - lastUsed(b));
    for (const chat of idle.slice(0, Math.max(0, idle.length - IDLE_CHATS_MAX))) {
      // A chat whose last write failed keeps its unsaved state in memory.
      const saved = await chat.flush().then(() => true, () => false);
      // Asked for, written to or removed meanwhile: it stays as it is.
      if (!saved || inUse(chat) || !liveChats().includes(chat)) continue;
      // Leaves the maps before anything awaits: the next lookup loads the
      // row anew, so there is still one live object per row.
      unregisterChat(chat);
      void chat.unload();
    }
  } finally {
    evicting = false;
  }
}

export const agentStore = {
  status,
  models,
  modelsLoading,
  learning,
  waiting,
  learnedVersion,
  available: hasAgentHost,
  openRouterKeyHint,
  /** The AgentZ account may use the hosted agent; else it is "coming soon". */
  hostedAccess,
  refreshHostedAccess,
  /** Stores the own OpenRouter key ("" removes it) and checks it. */
  async setOpenRouterKey(key: string): Promise<void> {
    await setOpenRouterKey(key);
    if (agentSettings.provider() === "openrouter") await refreshStatus();
  },
  refreshStatus,
  refreshModels,
  /** Clears memory and learned markers; every script may be learned again. */
  async clearMemory(): Promise<void> {
    await clearMemory();
    resetLearnChecks();
  },
  resolveModel: () => resolveModel(models(), agentSettings.model()),
  /** The live chat of a script, if one is loaded. */
  liveSession(scriptId: string): ChatSession | null {
    return byScript.get(scriptId) ?? null;
  },
  /** The chat of a script (panel). Resolves the script's newest chat row
   *  first, so a session already open in the agent mode is the very same
   *  object (two objects would overwrite each other's messages). */
  sessionFor(scriptId: string): Promise<ChatSession> {
    const live = byScript.get(scriptId);
    if (live) {
      touchChat(live);
      return Promise.resolve(live);
    }
    let pending = pendingScripts.get(scriptId);
    if (!pending) {
      pending = (async () => {
        const record = await latestChat(scriptId).catch((error: unknown) => {
          console.warn("[agent] loading chat failed", error);
          return null;
        });
        const again = byScript.get(scriptId);
        if (again) return again;
        const session = (record ? byChat.get(record.id) : undefined) ?? createChat({ kind: "script", scriptId, record });
        byScript.set(scriptId, session);
        if (record && !byChat.has(record.id)) byChat.set(record.id, session);
        chatsChanged();
        touchChat(session);
        scheduleEviction();
        return session;
      })().finally(() => pendingScripts.delete(scriptId));
      pendingScripts.set(scriptId, pending);
    }
    return pending;
  },
  /** A chat by id (agent mode). Unknown ids start a new, unsaved session. */
  chat(chatId: string, options: { folderId?: string | null } = {}): ChatSession {
    let session = byChat.get(chatId) ?? liveChats().find((chat) => chat.chatId() === chatId);
    if (!session) {
      session = createChat({ kind: "session", chatId, folderId: options.folderId });
      byChat.set(chatId, session);
      chatsChanged();
      scheduleEviction();
    }
    touchChat(session);
    return session;
  },
  /** Sessions for the start screen and the session menu, newest first. */
  sessions: sessionList,
  refreshSessions: refreshSessionList,
  /** Open drafts over all recent sessions (sidebar badge). */
  openDrafts: () => sessionList().reduce((sum, s) => sum + s.openDrafts, 0),
  anyRunning: () => liveChats().some((chat) => chat.running()),
  async deleteSession(chatId: string): Promise<void> {
    const live = liveChats().find((chat) => chat.chatId() === chatId);
    if (live) {
      // Ends the turn and drains writes; a late completion cannot store
      // the row again after it is deleted.
      await live.discard();
      unregisterChat(live);
    }
    await deleteChat(chatId);
    await refreshSessionList();
  },
  /** Chats replaced by the cloud sync: idle ones that are not on screen are
   *  unloaded, so the next lookup reads the new row. A chat in use keeps its
   *  state; its next write wins (chats sync as a whole). */
  remoteChatsChanged(chatIds: Iterable<string>): void {
    const ids = new Set(chatIds);
    for (const chat of liveChats()) {
      const id = chat.chatId();
      if (!id || !ids.has(id) || inUse(chat)) continue;
      unregisterChat(chat);
      void chat.unload();
    }
    chatsChanged();
    void refreshSessionList();
  },
  scheduleLearning,
  bootstrap,
  startBootstrap,
  cancelBootstrap,
  existingScriptCount,
};
