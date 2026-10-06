import { latestChat, deleteChat } from "../lib/agent/chats";
import { agentSettings } from "./agentSettings";
import { hasCodexHost, models, modelsLoading, refreshModels, refreshStatus, resolveModel, status } from "./agent/provider";
import { createChat } from "./agent/chat";
import { bootstrap, cancelBootstrap, existingScriptCount, learnedVersion, learning, scheduleLearning, startBootstrap, waiting } from "./agent/learning";
import { byChat, byScript, chatsChanged, liveChats, pendingScripts, unregisterChat } from "./agent/registry";
import { refreshSessionList, sessionList } from "./agent/sessionList";
import type { ChatSession } from "./agent/types";

// The agent store is split by concern under `stores/agent/`: provider and
// status, instructions, one live chat, item reducer, live chat registry,
// session list, learning and runtime. This file is its public face.

export type { AgentStatus } from "./agent/provider";
export { currentPace } from "./agent/instructions";
export type { ChatSession, SendOptions, ChatQuote } from "./agent/types";
export { sessionTitleFrom } from "./agent/chat";
export type { BootstrapState, LearnRef } from "./agent/learning";
export { startAgentRuntime } from "./agent/runtime";

export const agentStore = {
  status,
  models,
  modelsLoading,
  learning,
  waiting,
  learnedVersion,
  available: hasCodexHost,
  refreshStatus,
  refreshModels,
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
    if (live) return Promise.resolve(live);
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
    }
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
  scheduleLearning,
  bootstrap,
  startBootstrap,
  cancelBootstrap,
  existingScriptCount,
};
