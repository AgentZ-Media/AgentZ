// Ways into the agent mode. Every entry (sidebar, Mod+L, palette, ideas
// page, empty states) ends in a session of the same route.

import { t } from "../../i18n";
import type { Idea } from "../../lib/types";
import { agentStore } from "../../stores/agent";
import { agentSettings } from "../../stores/agentSettings";
import { agentUi } from "../../stores/agentUi";
import { navStore } from "../../stores/nav";
import { library } from "../Shell/libraryData";

/** The agent is offered (desktop with Codex host, not hidden by the user). */
export function agentModeAvailable(): boolean {
  return agentStore.available();
}

function existingFolder(id: string | null | undefined): string | null {
  return id && library.folder(id) ? id : null;
}

/** Folder for a new session: the one of the newest session. */
function defaultFolder(): string | null {
  return existingFolder(agentStore.sessions()[0]?.folderId ?? null);
}

/** Back to the agent mode: the session shown last, else a new one. */
export function openAgentMode(): Promise<void> {
  if (!agentSettings.onboarded()) {
    agentUi.openOnboarding();
    return Promise.resolve();
  }
  const current = navStore.activeAgentChatId();
  if (current) return Promise.resolve();
  return navStore.openAgent(agentUi.lastAgentChat() ?? crypto.randomUUID());
}

export interface StartOptions {
  folderId?: string | null;
  /** Message to send (or prefill) as soon as the session is on screen. */
  text?: string;
  hint?: string;
  send?: boolean;
}

/** A fresh session, optionally with a first message. */
export function startSession(options: StartOptions = {}): Promise<void> {
  if (!agentSettings.onboarded()) {
    agentUi.openOnboarding();
    return Promise.resolve();
  }
  const chatId = crypto.randomUUID();
  const folderId = options.folderId !== undefined ? existingFolder(options.folderId) : defaultFolder();
  agentStore.chat(chatId, { folderId });
  if (options.text) agentUi.requestMode({ chatId, text: options.text, hint: options.hint, send: options.send ?? true });
  return navStore.openAgent(chatId);
}

/** "Ideen mit Ida finden" for a folder (null = no folder chosen). */
export function findIdeasWithAgent(folderId: string | null): Promise<void> {
  const folder = existingFolder(folderId);
  const name = folder ? library.folder(folder)?.name ?? null : null;
  return startSession({
    folderId: folder,
    text: name ? t("agentMode.prompt.ideasFolder", { folder: name }) : t("agentMode.prompt.ideas"),
  });
}

/** "Mit Ida ausschreiben": a draft for a saved idea. */
export function writeIdeaWithAgent(idea: Idea): Promise<void> {
  const notes = idea.notes.trim().replace(/\s+/g, " ").slice(0, 800);
  return startSession({
    folderId: idea.folder_id,
    text: t("agentMode.prompt.writeIdea", { title: idea.title }),
    hint: `This is the saved idea with id ${idea.id}${notes ? `; its notes: ${notes}` : ""}. Set idea="${idea.id}" on the draft.`,
  });
}
