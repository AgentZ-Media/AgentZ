import { createSignal } from "solid-js";
import { DecisionError, account, decide } from "@agentz/kit/account";
import { getKvStore } from "@agentz/kit/platform";
import { createStatePersistence } from "@agentz/kit/stores";
import { liveBlocks } from "../../components/Agent/editorBridge";
import { CLAIM_CONTEXT, claimCandidates, claimKey, claimProbabilities, lineRequest, scriptRequests } from "../../lib/agent/claimScan";
import type { Claim } from "../../lib/agent/proposals";
import type { AgentBlock } from "../../lib/agent/scriptText";
import { createChatTools } from "../../lib/agent/tools";
import { effortOrDefault, type AgentEvent } from "../../lib/agent/types";
import { agentSettings } from "../agentSettings";
import { chatInstructions, currentPace } from "./instructions";
import { ensureModels, getProvider, hasAgentHost, hostedAccess, refreshHostedAccess, resolveModel } from "./provider";

// ---------------------------------------------------------------------------
// Checkable claims on the paper ("prüfbare Stellen")
// ---------------------------------------------------------------------------
//
// 1. Finding them: a decision model (Jev) answers, line by line, whether a
//    dialog line holds a checkable real-world claim (lib/agent/claimScan.ts).
//    It runs through the suite backend with the AgentZ account, so only for
//    signed-in accounts the backend has opened AI to (AI_ACCESS, the same
//    list as the hosted agent), and only while the agent is on. No switch of
//    its own: it belongs to the account's AI features. Results stay in
//    memory, keyed by the line's text.
// 2. Checking one: a click lets the agent fact-check that line in a
//    background thread of its own, with the same instructions and tools as
//    the chat (any provider), the whole script as context and web search.
//    The result shows on the paper; "Im Chat" copies it into the chat.
// 3. Done with one ("Erledigt", "Bewusst so lassen", fix applied): the line's
//    key is remembered per script on this device, so it is not marked again.

/** Scripts whose results stay in memory (least recently used go first). */
const SCRIPTS_KEPT = 30;
/** After a failed request the scan rests this long before asking again. */
const PAUSE_AFTER_ERROR_MS = 60_000;
/** Line requests running at once; more new lines go as one script request. */
const LINE_REQUESTS_MAX = 3;
/** Inline checks running at once over all scripts (each is an agent turn). */
const CHECKS_MAX = 2;
/** Resolved lines remembered per script. */
const RESOLVED_MAX = 300;

export type ClaimStep = "reading" | "searching" | "comparing";

export type ClaimCheck =
  | { state: "running"; step: ClaimStep; text: string }
  | { state: "done"; text: string; claim: Claim | null; note: string }
  | { state: "failed"; text: string; error: string };

interface ScriptClaims {
  /** Line key -> probability of a checkable claim. */
  probabilities: Map<string, number>;
  /** Line key -> inline check. */
  checks: Map<string, ClaimCheck>;
  /** Line keys the user is done with (loaded from the device). */
  resolved: Set<string>;
  resolvedLoaded: boolean;
}

const scripts = new Map<string, ScriptClaims>();
const [version, setVersion] = createSignal(0);
const bump = () => setVersion((v) => v + 1);

function claimsOf(scriptId: string): ScriptClaims {
  let entry = scripts.get(scriptId);
  if (entry) {
    // Most recently used last.
    scripts.delete(scriptId);
    scripts.set(scriptId, entry);
    return entry;
  }
  entry = { probabilities: new Map(), checks: new Map(), resolved: new Set(), resolvedLoaded: false };
  scripts.set(scriptId, entry);
  for (const [id, other] of scripts) {
    if (scripts.size <= SCRIPTS_KEPT) break;
    // Running checks keep their script.
    if ([...other.checks.values()].some((check) => check.state === "running")) continue;
    scripts.delete(id);
  }
  return entry;
}

/** Marking is on: AI features shown and switched on, agent set up, signed
 *  in with an account the backend has opened AI to. */
export function claimScanAllowed(): boolean {
  return hasAgentHost() && agentSettings.enabled() && agentSettings.onboarded() && account.signedIn() && hostedAccess();
}

/** Asks the backend once whether the signed-in account has AI access
 *  (cached in the provider store; nothing is sent while hidden). */
export function ensureClaimAccess(): void {
  if (hasAgentHost() && !agentSettings.hidden() && account.signedIn()) void refreshHostedAccess();
}

// ------------------------------------------------------------- reading state

export interface LineState {
  probability: number | null;
  check: ClaimCheck | null;
  resolved: boolean;
}

/** What is known about a line (reactive). */
export function lineState(scriptId: string, text: string): LineState {
  version();
  const entry = scripts.get(scriptId);
  const key = claimKey(text);
  return {
    probability: entry?.probabilities.get(key) ?? null,
    check: entry?.checks.get(key) ?? null,
    resolved: entry?.resolved.has(key) ?? false,
  };
}

// ------------------------------------------------------------------ scanning

export interface ClaimScanner {
  /** The script changed (debounced by the caller) or was opened. */
  update(blocks: readonly AgentBlock[]): void;
  dispose(): void;
}

/** Finds checkable lines of one open script: first everything at once, then
 *  every new or edited line with its neighbours. */
export function createClaimScanner(scriptId: string): ClaimScanner {
  const entry = () => claimsOf(scriptId);
  const pending = new Set<string>();
  const abort = new AbortController();
  let pausedUntil = 0;
  let running = 0;
  let disposed = false;
  /** The first look at a script goes as one request with the whole script. */
  let opened = false;

  const ask = async (blocks: readonly AgentBlock[], request: Parameters<typeof decide>[0], targets: readonly number[]) => {
    const keys = targets.map((index) => claimKey(blocks[index].text));
    keys.forEach((key) => pending.add(key));
    running += 1;
    try {
      const answers = claimProbabilities(await decide(request, { signal: abort.signal }));
      const probabilities = entry().probabilities;
      targets.forEach((index, i) => {
        const p = answers.get(index);
        if (p !== undefined) probabilities.set(keys[i], p);
      });
      bump();
    } catch (error) {
      if (abort.signal.aborted) return;
      pausedUntil = Date.now() + PAUSE_AFTER_ERROR_MS;
      // Access was withdrawn: the provider store learns it and marking stops.
      if (error instanceof DecisionError && error.code === "not-enabled") void refreshHostedAccess();
      else if (!(error instanceof DecisionError && error.code === "signed-out")) console.warn("[agent] claim scan failed", error);
    } finally {
      running -= 1;
      keys.forEach((key) => pending.delete(key));
    }
  };

  return {
    update(blocks) {
      if (disposed || !claimScanAllowed() || Date.now() < pausedUntil) return;
      const { probabilities, resolved } = entry();
      const missing = claimCandidates(blocks).filter((index) => {
        const key = claimKey(blocks[index].text);
        return !probabilities.has(key) && !pending.has(key) && !resolved.has(key);
      });
      if (missing.length === 0) return;
      const whole = !opened || missing.length > LINE_REQUESTS_MAX || running + missing.length > LINE_REQUESTS_MAX;
      opened = true;
      if (whole) {
        for (const request of scriptRequests(blocks, missing)) {
          const targets = Object.keys(request.questions).map((key) => Number(key.slice(1)));
          void ask(blocks, request, targets);
        }
        return;
      }
      for (const index of missing) void ask(blocks, lineRequest(blocks, index), [index]);
    },
    dispose() {
      disposed = true;
      abort.abort();
    },
  };
}

// ------------------------------------------------------------- inline checks

let checksRunning = 0;
const checkQueue: Array<() => void> = [];

function slot(): Promise<void> {
  if (checksRunning < CHECKS_MAX) {
    checksRunning += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => checkQueue.push(() => { checksRunning += 1; resolve(); }));
}

function release(): void {
  checksRunning -= 1;
  checkQueue.shift()?.();
}

const STEP_OF_TOOL: Record<string, ClaimStep> = {
  get_current_script: "reading",
  web_search: "searching",
  report_fact_check: "comparing",
};

function checkInput(index: number, text: string): string {
  return [
    `Fact-check only line [${index}] of the current script:`,
    `"""${text}"""`,
    `Read the whole script with get_current_script first: the claim may only make sense with the ${CLAIM_CONTEXT} lines before it (a reference like "that law", the answer to a question). Check this one claim, search the web, then call report_fact_check with exactly one claim whose quote is taken from line [${index}]. Offer a fix only if the line is wrong or imprecise, and keep the joke and the character's voice.`,
    "If the line holds no checkable real-world claim after all, do not call report_fact_check; say so in one short sentence.",
  ].join("\n\n");
}

/** Fact-checks one line in a background thread of the agent and keeps the
 *  result for the paper. Runs on whatever provider is chosen. */
export async function checkClaim(scriptId: string, index: number, text: string): Promise<void> {
  const key = claimKey(text);
  const set = (check: ClaimCheck) => {
    claimsOf(scriptId).checks.set(key, check);
    bump();
  };
  const current = scripts.get(scriptId)?.checks.get(key);
  if (current?.state === "running") return;
  set({ state: "running", step: "reading", text });
  await slot();
  let claim: Claim | null = null;
  let note = "";
  try {
    const provider = getProvider();
    if (!provider) throw new Error("agent unavailable");
    const tools = createChatTools({
      scriptId,
      liveBlocks: () => liveBlocks(scriptId),
      selection: () => null,
      onProposal: () => {},
      onClaims: (claims) => { claim = claims[0] ?? null; },
      onMemory: () => {},
      memorySource: "chat",
      memorySourceScriptId: null,
      wpm: () => currentPace().wpm,
    }).filter((tool) => tool.name === "get_current_script" || tool.name === "report_fact_check");
    const [instructions, models] = await Promise.all([chatInstructions(scriptId, "script", null), ensureModels()]);
    const thread = await provider.openThread({ instructions, tools, ephemeral: true });
    try {
      const model = resolveModel(models, agentSettings.model());
      const onEvent = (event: AgentEvent) => {
        if (event.type === "message" && !event.commentary) note = event.text.trim();
        const step = event.type === "tool-start" ? STEP_OF_TOOL[event.tool] : event.type === "web-search" ? "searching" : undefined;
        if (step) set({ state: "running", step, text });
      };
      const result = await thread.run(checkInput(index, text), {
        model: model?.id ?? "",
        effort: effortOrDefault(model, agentSettings.effort()),
      }, onEvent);
      if (result.status !== "completed") throw new Error(result.error ?? result.status);
    } finally {
      void thread.close().catch(() => {});
    }
    set({ state: "done", text, claim, note });
  } catch (error) {
    set({ state: "failed", text, error: error instanceof Error ? error.message : String(error) });
  } finally {
    release();
  }
}

/** Forgets a finished or failed check (the line shows as checkable again). */
export function clearCheck(scriptId: string, text: string): void {
  if (scripts.get(scriptId)?.checks.delete(claimKey(text))) bump();
}

// ------------------------------------------------------------------ resolved

const RESOLVED_KEY = (scriptId: string) => `script.${scriptId}.claims_resolved`;
let resolvedWrite: { scriptId: string; write: ReturnType<typeof createStatePersistence> } | null = null;

/** Loads the lines the user is done with in this script (once per session). */
export async function loadResolved(scriptId: string): Promise<void> {
  const entry = claimsOf(scriptId);
  if (entry.resolvedLoaded) return;
  entry.resolvedLoaded = true;
  try {
    const raw = await getKvStore().getAppState(RESOLVED_KEY(scriptId));
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) for (const key of list) if (typeof key === "string") entry.resolved.add(key);
    bump();
  } catch {
    // Nothing remembered: lines show again, nothing is lost.
  }
}

/** The user is done with a line: its mark and result leave the paper. */
export function resolveClaim(scriptId: string, text: string): void {
  const entry = claimsOf(scriptId);
  const key = claimKey(text);
  entry.resolved.delete(key);
  entry.resolved.add(key);
  while (entry.resolved.size > RESOLVED_MAX) entry.resolved.delete(entry.resolved.values().next().value as string);
  entry.checks.delete(key);
  bump();
  persistResolved(scriptId, entry.resolved);
}

/** One write channel at a time: switching scripts flushes the previous one. */
function persistResolved(scriptId: string, resolved: ReadonlySet<string>): void {
  if (resolvedWrite?.scriptId !== scriptId) {
    resolvedWrite?.write.dispose();
    resolvedWrite = { scriptId, write: createStatePersistence(getKvStore(), RESOLVED_KEY(scriptId)) };
  }
  resolvedWrite.write.schedule(JSON.stringify([...resolved]));
}

/** Undo of `resolveClaim` (toast): the line and its result come back. */
export function unresolveClaim(scriptId: string, text: string, check: ClaimCheck | null): void {
  const entry = claimsOf(scriptId);
  const key = claimKey(text);
  entry.resolved.delete(key);
  if (check) entry.checks.set(key, check);
  bump();
  persistResolved(scriptId, entry.resolved);
}

/** Test hook: forgets everything. */
export function resetClaimsForTests(): void {
  scripts.clear();
  checksRunning = 0;
  checkQueue.length = 0;
  resolvedWrite = null;
  bump();
}
