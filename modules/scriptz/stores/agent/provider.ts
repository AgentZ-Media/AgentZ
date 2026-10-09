import { createSignal } from "solid-js";
import { account } from "@agentz/kit/account";
import type { SecretStore } from "@agentz/kit/platform";
import { CodexProvider, type CodexHostLike } from "../../lib/agent/codex/provider";
import { OpenRouterProvider } from "../../lib/agent/openrouter/provider";
import { hostedTransport, keyHint, keyTransport, type OpenRouterTransport } from "../../lib/agent/openrouter/transport";
import { threadStore } from "../../lib/agent/threads";
import { AGENT_NOT_ENABLED, type AgentModel, type AgentProvider, type ProviderState } from "../../lib/agent/types";
import { agentSettings, type AgentProviderId } from "../agentSettings";

// ---------------------------------------------------------------------------
// Provider + status
// ---------------------------------------------------------------------------
//
// Three ways to run the same agent (agent.provider):
// - "codex": the user's local Codex (ChatGPT plan) through codex app-server,
// - "agentz": the hosted harness with the suite's OpenRouter key, for
//   signed-in AgentZ accounts the backend has opened it to (AI_ACCESS in
//   apps/site/convex/ai.ts); everyone else sees "coming soon",
// - "openrouter": the same harness with the user's own OpenRouter key.

let codexHost: CodexHostLike | null = null;
/** True in builds with the desktop host (the agent exists at all). */
let hostReady = false;
let secrets: SecretStore | null = null;
let provider: AgentProvider | null = null;

export type AgentStatus = ProviderState | { state: "checking" } | { state: "unavailable" };
const [status, setStatus] = createSignal<AgentStatus>({ state: "checking" });
const [models, setModels] = createSignal<AgentModel[]>([]);
const [modelsLoading, setModelsLoading] = createSignal(false);
/** Hint of the stored own OpenRouter key ("…abcd"), null without one. */
const [keyHintSignal, setKeyHint] = createSignal<string | null>(null);
/** The signed-in account may use the hosted agent ("agentz"). False until a
 *  check says so; the choice shows "coming soon" meanwhile. */
const [hostedAccess, setHostedAccess] = createSignal(false);
export { status, models, modelsLoading, keyHintSignal as openRouterKeyHint, hostedAccess };

/** Keychain entry of the own OpenRouter key (never in settings or sync). */
const KEY_SECRET = "agent.openrouter-key";
/** Without a keychain (non-desktop hosts) the key lasts for the session. */
let memoryKey: string | null = null;

function isCodexHost(value: unknown): value is CodexHostLike {
  const v = value as Partial<CodexHostLike> | null;
  return !!v && typeof v.locate === "function" && typeof v.start === "function";
}

/** Takes the Codex host from the desktop services; without one there is no
 *  agent in this build. The keychain holds the own OpenRouter key. */
export function setAgentHost(services: Readonly<Record<string, unknown>>, store: SecretStore | null | undefined): void {
  codexHost = isCodexHost(services.codexHost) ? services.codexHost : null;
  hostReady = codexHost !== null;
  secrets = store ?? null;
  void readKey().then((key) => setKeyHint(key ? keyHint(key) : null)).catch(() => setKeyHint(null));
}

export function clearAgentHost(): void {
  codexHost = null;
  hostReady = false;
  secrets = null;
  memoryKey = null;
  setKeyHint(null);
  setHostedAccess(false);
}

export function hasAgentHost(): boolean {
  return hostReady;
}

async function readKey(): Promise<string | null> {
  if (!secrets) return memoryKey;
  return (await secrets.get(KEY_SECRET).catch(() => null)) ?? null;
}

/** Stores (or with "" removes) the own OpenRouter key. */
export async function setOpenRouterKey(raw: string): Promise<void> {
  const key = raw.trim();
  if (secrets) {
    if (key) await secrets.set(KEY_SECRET, key);
    else await secrets.delete(KEY_SECRET);
  } else {
    memoryKey = key || null;
  }
  setKeyHint(key ? keyHint(key) : null);
  // A check still running for the old key must not answer for the new one.
  invalidateStatusCheck();
}

/** The provider currently in use, without creating one. */
export function currentProvider(): AgentProvider | null {
  return provider;
}

function hosted(): OpenRouterTransport {
  return hostedTransport({
    signedIn: () => account.signedIn(),
    fetch: (path, init) => account.backendFetch(path, init),
  });
}

/** Takes what a check of the hosted agent says about access. A passing
 *  failure (network, server) keeps what was known. */
function noteHostedAccess(state: AgentStatus): void {
  if (state.state === "ready") setHostedAccess(true);
  else if (state.state === "logged-out" || (state.state === "error" && state.message === AGENT_NOT_ENABLED)) setHostedAccess(false);
}

let accessCheck: Promise<boolean> | null = null;
/** Account the running access check asks for. */
let accessAccount: string | null = null;

/** Asks the backend whether the signed-in account may use the hosted agent,
 *  whichever provider is chosen (the picker shows "coming soon" without). */
export function refreshHostedAccess(): Promise<boolean> {
  // Hidden: no request to the AI proxy, not even this one.
  if (agentSettings.hidden()) return Promise.resolve(hostedAccess());
  if (!hostReady || !account.signedIn()) {
    // Signed out: no access, and a check of the old session is stale.
    accessCheck = null;
    accessAccount = null;
    setHostedAccess(false);
    return Promise.resolve(false);
  }
  const who = account.user()?.id ?? "";
  if (accessCheck && accessAccount === who) return accessCheck;
  accessAccount = who;
  const run = hosted().check()
    .then((result) => {
      // Only the answer for the account that is still signed in counts.
      if (accessCheck === run && account.signedIn() && (account.user()?.id ?? "") === who) noteHostedAccess(result.state);
      return hostedAccess();
    })
    .finally(() => { if (accessCheck === run) accessCheck = null; });
  accessCheck = run;
  return run;
}

function createProvider(id: AgentProviderId): AgentProvider | null {
  if (!hostReady) return null;
  switch (id) {
    case "codex":
      return codexHost ? new CodexProvider(codexHost) : null;
    case "agentz":
      return new OpenRouterProvider("agentz", hosted(), threadStore);
    case "openrouter":
      return new OpenRouterProvider("openrouter", keyTransport({ key: readKey }), threadStore);
  }
}

/** The provider in use, created on demand. Never while the agent is hidden:
 *  hidden means no Codex process and no request to OpenRouter or the
 *  AgentZ proxy, whatever path asks. */
export function getProvider(): AgentProvider | null {
  if (agentSettings.hidden()) return null;
  if (provider) return provider;
  provider = createProvider(agentSettings.provider());
  return provider;
}

let statusCheck: Promise<AgentStatus> | null = null;
/** Bumped when credentials change; older checks are then stale. */
let statusGeneration = 0;

/** Forgets a running check, so the next one asks again. */
export function invalidateStatusCheck(): void {
  statusCheck = null;
  statusGeneration += 1;
}

/** One check at a time. Never re-sets "checking" while checking, so effects
 *  that react to the status cannot loop. */
export function refreshStatus(): Promise<AgentStatus> {
  if (statusCheck) return statusCheck;
  // Hidden: keep "checking", so showing the agent again checks afresh.
  if (agentSettings.hidden()) return Promise.resolve(status());
  const p = getProvider();
  if (!p) {
    setStatus({ state: "unavailable" });
    return Promise.resolve(status());
  }
  if (status().state !== "checking") setStatus({ state: "checking" });
  const generation = statusGeneration;
  const run = p.check()
    .catch((error: unknown): AgentStatus => ({ state: "error", message: error instanceof Error ? error.message : String(error) }))
    .then((next) => {
      // A check that outlived its provider (agent switched off) or its
      // credentials (other key, other account) is stale.
      if (provider === p && generation === statusGeneration) {
        setStatus(next);
        if (agentSettings.provider() === "agentz") noteHostedAccess(next);
      }
      return next;
    })
    .finally(() => { if (statusCheck === run) statusCheck = null; });
  statusCheck = run;
  return run;
}

export async function refreshModels(): Promise<AgentModel[]> {
  const p = getProvider();
  if (!p) return [];
  setModelsLoading(true);
  try {
    const list = await p.listModels();
    if (provider === p) setModels(list);
    return list;
  } finally {
    setModelsLoading(false);
  }
}

export async function ensureModels(): Promise<AgentModel[]> {
  return models().length ? models() : refreshModels().catch(() => []);
}

/** The chosen model, else the provider's default, else the first. */
export function resolveModel(list: readonly AgentModel[], chosen: string): AgentModel | undefined {
  return list.find((m) => m.id === chosen) ?? list.find((m) => m.isDefault) ?? list[0];
}

/** The model of a fact check: the provider's check model, else the chat
 *  model. Only for that turn; the chat goes on with `resolveModel`. */
export function resolveCheckModel(list: readonly AgentModel[], chosen: string): AgentModel | undefined {
  return getProvider()?.checkModel(list) ?? resolveModel(list, chosen);
}

/** Ends the provider (Codex process, running harness turns) and forgets
 *  status and models. The next status check starts a fresh provider. */
export function disposeProvider(): void {
  const p = provider;
  provider = null;
  invalidateStatusCheck();
  setStatus({ state: "checking" });
  setModels([]);
  if (p) void p.dispose();
}
