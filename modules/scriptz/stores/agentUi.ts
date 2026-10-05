import { createSignal } from "solid-js";
import type { AgentJobId } from "../lib/agent/jobs";

/**
 * UI state of the agent: which scripts have the chat open, the agent
 * onboarding, the memory dialog and requests from the editor's context menu.
 *
 * The chat starts closed in every script and only opens on request. It is
 * remembered per script for the session, so switching scripts closes it and
 * coming back restores it. Nothing is persisted.
 */

const [openChats, setOpenChats] = createSignal<ReadonlySet<string>>(new Set());
const [onboardingOpen, setOnboardingOpen] = createSignal(false);
/** First step shown when the onboarding opens (2 = personality only). */
const [onboardingStep, setOnboardingStep] = createSignal(0);
const [memoryOpen, setMemoryOpen] = createSignal(false);

export interface ChatRequest {
  scriptId: string;
  /** What the chat shows as the user's message (or prefills). */
  text: string;
  quote?: { text: string; from: number; to: number };
  /** Send immediately (context-menu action) or just prefill the composer. */
  send: boolean;
  /** A fixed job (lib/agent/jobs.ts): the chat builds its instruction. */
  job?: AgentJobId;
  /** Model-facing instruction sent instead of `text` (e.g. a voice
   *  rewrite); the chat still shows `text`. */
  instruction?: string;
}
const [request, setRequest] = createSignal<ChatRequest | null>(null);

export const agentUi = {
  chatOpen: (scriptId: string) => openChats().has(scriptId),
  setChatOpen(scriptId: string, open: boolean) {
    if (openChats().has(scriptId) === open) return;
    const next = new Set(openChats());
    if (open) next.add(scriptId);
    else next.delete(scriptId);
    setOpenChats(next);
  },
  toggleChat(scriptId: string) {
    agentUi.setChatOpen(scriptId, !agentUi.chatOpen(scriptId));
  },
  onboardingOpen,
  onboardingStep,
  openOnboarding: (step = 0) => { setOnboardingStep(step); setOnboardingOpen(true); },
  closeOnboarding: () => setOnboardingOpen(false),
  memoryOpen,
  openMemory: () => setMemoryOpen(true),
  closeMemory: () => setMemoryOpen(false),
  request,
  /** Opens the chat and hands it a message (context menu). */
  ask(next: ChatRequest) {
    agentUi.setChatOpen(next.scriptId, true);
    setRequest(next);
  },
  takeRequest(scriptId: string): ChatRequest | null {
    const current = request();
    if (!current || current.scriptId !== scriptId) return null;
    setRequest(null);
    return current;
  },
  anyDialogOpen: () => onboardingOpen() || memoryOpen(),
};

export function startAgentUiRuntime(): () => void {
  setOpenChats(new Set<string>());
  setOnboardingOpen(false);
  setMemoryOpen(false);
  setRequest(null);
  return () => setOpenChats(new Set<string>());
}
