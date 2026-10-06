import { createEffect, createRoot, on } from "solid-js";
import { registerFlusher } from "@agentz/kit/lib";
import { api } from "../../lib/api";
import { scriptsBus } from "../../lib/scriptsBus";
import { foldersBus } from "../../lib/foldersBus";
import { agentSettings } from "../agentSettings";
import { agentUi } from "../agentUi";
import { clearCodexHost, currentProvider, disposeProvider, hasCodexHost, setCodexHost } from "./provider";
import { finishedStageIds, scheduleLearning, stopLearning } from "./learning";
import { clearLiveChats, liveChats, unregisterChat } from "./registry";
import { refreshSessionList, resetSessionList, sessionsVersion } from "./sessionList";

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

/** Live chats whose script or folder was deleted for good follow along:
 *  a session goes on without them, a script chat is gone with its row. */
async function reconcileLiveChats(): Promise<void> {
  const chats = liveChats();
  if (chats.length === 0) return;
  // null = the read failed: then nothing is changed (an empty list is a
  // real answer, e.g. the last folder was deleted).
  const list = await api.listFolders().catch(() => null);
  const folders = list ? new Set(list.map((f) => f.id)) : null;
  for (const chat of chats) {
    const folder = chat.folderId();
    if (folder && folders && !folders.has(folder)) chat.forgetFolder();
    const script = chat.scriptId();
    if (!script) continue;
    // Only a definite "not found" counts; a failed read changes nothing.
    const gone = await api.getScript(script).then(
      () => false,
      (error: unknown) => error instanceof Error && error.message.startsWith("not found"),
    );
    if (!gone) continue;
    if (chat.kind() === "session") {
      chat.detachFromScript();
    } else {
      await chat.discard();
      unregisterChat(chat);
    }
  }
}

/** Ends the Codex process and all turns; chats stay visible. Used when the
 *  agent is switched off. The status check after switching back on starts a
 *  fresh provider. */
function shutdownProvider(): void {
  stopLearning({ clearIndicator: true });
  for (const session of liveChats()) session.release();
  disposeProvider();
}

export function startAgentRuntime(services: Readonly<Record<string, unknown>>): () => void {
  setCodexHost(services.codexHost);
  // Any script change (stage, content, import) may finish a script.
  const disposeWatch = createRoot((dispose) => {
    createEffect(on(scriptsBus.version, () => scheduleLearning(), { defer: true }));
    // Switching learning on or moving the learn stage may make scripts due.
    createEffect(on(() => (agentSettings.enabled() && agentSettings.onboarded() && agentSettings.learnFromScripts()
      ? finishedStageIds().join(",")
      : ""), (key) => {
      if (key) scheduleLearning(3000);
    }));
    createEffect(on(agentSettings.enabled, (enabled) => {
      if (!enabled) shutdownProvider();
    }, { defer: true }));
    // Onboarding checks Codex before the agent is on; cancelling it must not
    // leave the process running.
    createEffect(on(agentUi.onboardingOpen, (open) => {
      if (!open && !agentSettings.enabled() && currentProvider()) shutdownProvider();
    }, { defer: true }));
    // The session list follows every session write (and ideas/scripts that
    // a finished draft touched).
    // Only where the agent exists at all (no queries in builds without it).
    createEffect(on(sessionsVersion, () => { if (hasCodexHost()) void refreshSessionList(); }));
    createEffect(on([scriptsBus.version, foldersBus.version], () => {
      if (hasCodexHost()) void reconcileLiveChats().catch((error) => console.warn("[agent] reconciling chats failed", error));
    }, { defer: true }));
    return dispose;
  });
  // Closing and quitting wait for chat writes (applied options, undos).
  const offFlush = registerFlusher(
    () => Promise.all(liveChats().map((session) => session.flush())).then(() => undefined),
    "agent-chats",
    "state",
  );
  return () => {
    offFlush();
    disposeWatch();
    stopLearning({ resetProgress: true, clearIndicator: true });
    // Keep the chats: teardown is not "New chat". Disposing the provider below
    // ends running turns; pending writes still go out.
    for (const session of liveChats()) {
      session.release();
      void session.flush().catch(() => {});
    }
    clearLiveChats();
    resetSessionList();
    clearCodexHost();
    disposeProvider();
  };
}
