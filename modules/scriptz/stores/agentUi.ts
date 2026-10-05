import { createSignal } from "solid-js";
import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { createStatePersistence } from "@agentz/kit/stores";

/**
 * UI state of the agent: chat panel visibility (persisted in its own
 * app_state key, so `ui.layout` keeps its published JSON form), the agent
 * onboarding, the memory dialog and requests from the editor's context menu.
 */

const PANEL_KEY = "agent.chat_open";

const [chatOpen, setChatOpen] = createSignal(false);
const [onboardingOpen, setOnboardingOpen] = createSignal(false);
/** First step shown when the onboarding opens (2 = personality only). */
const [onboardingStep, setOnboardingStep] = createSignal(0);
const [memoryOpen, setMemoryOpen] = createSignal(false);

export interface ChatRequest {
  scriptId: string;
  text: string;
  quote?: { text: string; from: number; to: number };
  /** Send immediately (context-menu action) or just prefill the composer. */
  send: boolean;
}
const [request, setRequest] = createSignal<ChatRequest | null>(null);

let persistence: ReturnType<typeof createStatePersistence> | undefined;

export const agentUi = {
  chatOpen,
  setChatOpen(open: boolean) {
    setChatOpen(open);
    persistence?.schedule(open ? "1" : "0");
  },
  toggleChat() {
    agentUi.setChatOpen(!chatOpen());
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
    agentUi.setChatOpen(true);
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

export function startAgentUiRuntime(kv: KvStore = getKvStore()): () => void {
  const own = createStatePersistence(kv, PANEL_KEY);
  persistence = own;
  setOnboardingOpen(false);
  setMemoryOpen(false);
  setRequest(null);
  let active = true;
  void kv.getAppState(PANEL_KEY).then((raw) => {
    if (active) setChatOpen(raw === "1");
  }).catch(() => {});
  return () => {
    active = false;
    own.dispose();
    if (persistence === own) persistence = undefined;
  };
}
