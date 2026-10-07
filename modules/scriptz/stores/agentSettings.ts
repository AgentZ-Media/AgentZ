import { createSignal } from "solid-js";
import { getKvStore, type KvStore } from "@agentz/kit/platform";
import { createSettingsWriter } from "@agentz/kit/stores";
import { DEFAULT_EFFORT, isAgentEffort, type AgentEffort } from "../lib/agent/types";
import { isStageId } from "../lib/stages";

/**
 * Agent preferences (Settings > Agent and the agent onboarding). All keys
 * live under `agent.` in the settings table. Never use the `ai.*` prefix
 * (cleared by migration 002).
 */

export type AgentLook = "eyes" | "z" | "diamond" | "spark";
export const AGENT_LOOKS: readonly AgentLook[] = ["eyes", "z", "diamond", "spark"];

export type AgentTrait = "direct" | "dry" | "encouraging" | "critical" | "brief" | "detailed";
export const AGENT_TRAITS: readonly AgentTrait[] = ["direct", "dry", "encouraging", "critical", "brief", "detailed"];
const DEFAULT_TRAITS: AgentTrait[] = ["direct", "dry", "critical"];

/** How the agent runs (stores/agent/provider.ts). Per device, never synced. */
export type AgentProviderId = "codex" | "agentz" | "openrouter";
export const AGENT_PROVIDERS: readonly AgentProviderId[] = ["codex", "agentz", "openrouter"];
const isProviderId = (v: unknown): v is AgentProviderId => typeof v === "string" && (AGENT_PROVIDERS as readonly string[]).includes(v);

export const AGENT_NAME_MAX = 24;
export const AGENT_INSTRUCTIONS_MAX = 1200;

const KEYS = {
  enabled: "agent.enabled",
  hidden: "agent.hidden",
  onboarded: "agent.onboarded",
  provider: "agent.provider",
  name: "agent.name",
  look: "agent.look",
  traits: "agent.traits",
  instructions: "agent.instructions",
  userName: "agent.user_name",
  model: "agent.model",
  effort: "agent.effort",
  learnModel: "agent.learn_model",
  learnEffort: "agent.learn_effort",
  learnFromScripts: "agent.learn_scripts",
  learnFromChat: "agent.learn_chat",
  learnSince: "agent.learn_since",
  learnStage: "agent.learn_stage",
} as const;

const [enabled, setEnabled] = createSignal(false);
/** The user chose not to see any AI feature (onboarding or settings). */
const [hidden, setHidden] = createSignal(false);
const [onboarded, setOnboarded] = createSignal(false);
const [provider, setProvider] = createSignal<AgentProviderId>("codex");
const [name, setName] = createSignal("");
const [look, setLook] = createSignal<AgentLook>("eyes");
const [traits, setTraits] = createSignal<AgentTrait[]>(DEFAULT_TRAITS);
const [instructions, setInstructions] = createSignal("");
const [userName, setUserName] = createSignal("");
/** Empty = the provider's default model. */
const [model, setModel] = createSignal("");
const [effort, setEffort] = createSignal<AgentEffort>(DEFAULT_EFFORT);
const [learnModel, setLearnModel] = createSignal("");
const [learnEffort, setLearnEffort] = createSignal<AgentEffort>(DEFAULT_EFFORT);
const [learnFromScripts, setLearnFromScripts] = createSignal(true);
const [learnFromChat, setLearnFromChat] = createSignal(true);
/** Scripts finished before this moment (ms) are only learned via the
 *  explicit "learn from all scripts" action, never automatically. */
const [learnSince, setLearnSince] = createSignal(0);
/** Stage id from which scripts count as finished for learning; empty = the
 *  last stage. Resolved against the live pipeline in lib/agent/learnStage.ts. */
const [learnStage, setLearnStage] = createSignal("");
const [loaded, setLoaded] = createSignal(false);

let writer: ReturnType<typeof createSettingsWriter> | undefined;
let settingsKv: KvStore | undefined;
let generation = 0;

function persist(key: string, value: string): Promise<void> {
  if (!writer) throw new Error("Agent settings runtime has not started.");
  return writer.write(key, value);
}

export function cleanAgentName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, AGENT_NAME_MAX);
}

function parseLook(raw: string | null): AgentLook {
  return raw && (AGENT_LOOKS as readonly string[]).includes(raw) ? (raw as AgentLook) : "eyes";
}

function parseTraits(raw: string | null): AgentTrait[] {
  if (raw === null) return DEFAULT_TRAITS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TRAITS;
    return parsed.filter((v): v is AgentTrait => typeof v === "string" && (AGENT_TRAITS as readonly string[]).includes(v));
  } catch {
    return DEFAULT_TRAITS;
  }
}

const flag = (raw: string | null, fallback: boolean) => (raw === null ? fallback : raw === "1");
const effortOf = (raw: string | null): AgentEffort => (isAgentEffort(raw) ? raw : DEFAULT_EFFORT);

export const agentSettings = {
  loaded,
  /** On and not hidden: hiding pauses the agent without forgetting the
   *  switch, showing it again restores the previous state. */
  enabled: () => enabled() && !hidden(),
  setEnabled: async (v: boolean) => { setEnabled(v); await persist(KEYS.enabled, v ? "1" : "0"); },
  hidden,
  setHidden: async (v: boolean) => { setHidden(v); await persist(KEYS.hidden, v ? "1" : "0"); },
  onboarded,
  setOnboarded: async (v: boolean) => { setOnboarded(v); await persist(KEYS.onboarded, v ? "1" : "0"); },
  provider,
  setProvider: async (v: AgentProviderId) => { setProvider(v); await persist(KEYS.provider, v); },
  name,
  /** The name shown in the UI; falls back to a neutral default. */
  displayName: () => name() || "Ida",
  setName: async (v: string) => { const next = cleanAgentName(v); setName(next); await persist(KEYS.name, next); },
  look,
  setLook: async (v: AgentLook) => { setLook(v); await persist(KEYS.look, v); },
  traits,
  setTraits: async (v: AgentTrait[]) => {
    const next = AGENT_TRAITS.filter((trait) => v.includes(trait));
    setTraits(next);
    await persist(KEYS.traits, JSON.stringify(next));
  },
  instructions,
  setInstructions: async (v: string) => {
    const next = v.trim().slice(0, AGENT_INSTRUCTIONS_MAX);
    setInstructions(next);
    await persist(KEYS.instructions, next);
  },
  userName,
  setUserName: async (v: string) => { const next = cleanAgentName(v); setUserName(next); await persist(KEYS.userName, next); },
  model,
  setModel: async (v: string) => { setModel(v); await persist(KEYS.model, v); },
  effort,
  setEffort: async (v: AgentEffort) => { setEffort(v); await persist(KEYS.effort, v); },
  learnModel,
  setLearnModel: async (v: string) => { setLearnModel(v); await persist(KEYS.learnModel, v); },
  learnEffort,
  setLearnEffort: async (v: AgentEffort) => { setLearnEffort(v); await persist(KEYS.learnEffort, v); },
  learnFromScripts,
  setLearnFromScripts: async (v: boolean) => { setLearnFromScripts(v); await persist(KEYS.learnFromScripts, v ? "1" : "0"); },
  learnFromChat,
  setLearnFromChat: async (v: boolean) => { setLearnFromChat(v); await persist(KEYS.learnFromChat, v ? "1" : "0"); },
  learnSince,
  /** Sets the automatic-learning baseline once (first setup). */
  markLearnSince: async () => {
    if (learnSince() > 0) return;
    const now = Date.now();
    setLearnSince(now);
    await persist(KEYS.learnSince, String(now));
  },
  learnStage,
  setLearnStage: async (v: string) => {
    const next = isStageId(v) ? v : "";
    setLearnStage(next);
    await persist(KEYS.learnStage, next);
  },

  async load() {
    const gen = generation;
    const kv = settingsKv ?? getKvStore();
    const values = await Promise.all(Object.values(KEYS).map((key) => kv.getSetting(key)));
    if (gen !== generation) return;
    const get = (key: keyof typeof KEYS) => values[Object.keys(KEYS).indexOf(key)] ?? null;
    setEnabled(flag(get("enabled"), false));
    setHidden(flag(get("hidden"), false));
    setOnboarded(flag(get("onboarded"), false));
    const providerId = get("provider");
    setProvider(isProviderId(providerId) ? providerId : "codex");
    setName(cleanAgentName(get("name") ?? ""));
    setLook(parseLook(get("look")));
    setTraits(parseTraits(get("traits")));
    setInstructions(get("instructions") ?? "");
    setUserName(cleanAgentName(get("userName") ?? ""));
    setModel(get("model") ?? "");
    setEffort(effortOf(get("effort")));
    setLearnModel(get("learnModel") ?? "");
    setLearnEffort(effortOf(get("learnEffort")));
    setLearnFromScripts(flag(get("learnFromScripts"), true));
    setLearnFromChat(flag(get("learnFromChat"), true));
    const since = Number(get("learnSince"));
    setLearnSince(Number.isFinite(since) && since > 0 ? since : 0);
    const stage = get("learnStage");
    setLearnStage(isStageId(stage) ? stage : "");
    setLoaded(true);
  },
};

export function startAgentSettingsRuntime(kv: KvStore = getKvStore()): () => void {
  generation += 1;
  setLoaded(false);
  settingsKv = kv;
  const runtimeWriter = createSettingsWriter(kv, "agent-settings");
  writer = runtimeWriter;
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    generation += 1;
    runtimeWriter.dispose();
    if (writer === runtimeWriter) writer = undefined;
    settingsKv = undefined;
    setLoaded(false);
  };
}
