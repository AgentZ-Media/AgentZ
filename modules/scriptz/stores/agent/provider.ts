import { createSignal } from "solid-js";
import { CodexProvider, type CodexHostLike } from "../../lib/agent/codex/provider";
import type { AgentModel, AgentProvider, ProviderState } from "../../lib/agent/types";

// ---------------------------------------------------------------------------
// Provider + status
// ---------------------------------------------------------------------------

let codexHost: CodexHostLike | null = null;
let provider: AgentProvider | null = null;

export type AgentStatus = ProviderState | { state: "checking" } | { state: "unavailable" };
const [status, setStatus] = createSignal<AgentStatus>({ state: "checking" });
const [models, setModels] = createSignal<AgentModel[]>([]);
const [modelsLoading, setModelsLoading] = createSignal(false);
export { status, models, modelsLoading };

function isCodexHost(value: unknown): value is CodexHostLike {
  const v = value as Partial<CodexHostLike> | null;
  return !!v && typeof v.locate === "function" && typeof v.start === "function";
}

/** Takes the Codex host from the desktop services; anything else means no agent. */
export function setCodexHost(value: unknown): void {
  codexHost = isCodexHost(value) ? value : null;
}

export function clearCodexHost(): void {
  codexHost = null;
}

export function hasCodexHost(): boolean {
  return codexHost !== null;
}

/** The provider currently in use, without creating one. */
export function currentProvider(): AgentProvider | null {
  return provider;
}

export function getProvider(): AgentProvider | null {
  if (provider) return provider;
  if (!codexHost) return null;
  provider = new CodexProvider(codexHost);
  return provider;
}

let statusCheck: Promise<AgentStatus> | null = null;

/** One check at a time. Never re-sets "checking" while checking, so effects
 *  that react to the status cannot loop. */
export function refreshStatus(): Promise<AgentStatus> {
  if (statusCheck) return statusCheck;
  const p = getProvider();
  if (!p) {
    setStatus({ state: "unavailable" });
    return Promise.resolve(status());
  }
  if (status().state !== "checking") setStatus({ state: "checking" });
  const run = p.check()
    .catch((error: unknown): AgentStatus => ({ state: "error", message: error instanceof Error ? error.message : String(error) }))
    .then((next) => {
      // A check that outlived its provider (agent switched off) is stale.
      if (provider === p) setStatus(next);
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
    setModels(list);
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

/** Ends the Codex process and forgets status and models. The next status
 *  check starts a fresh provider. */
export function disposeProvider(): void {
  const p = provider;
  provider = null;
  statusCheck = null;
  setStatus({ state: "checking" });
  setModels([]);
  if (p) void p.dispose();
}
