import { createSignal } from "solid-js";
import { DecisionError, account, decide } from "@agentz/kit/account";
import { getKvStore } from "@agentz/kit/platform";
import { createStatePersistence } from "@agentz/kit/stores";
import { liveBlocks } from "../../components/Agent/editorBridge";
import { CLAIM_CONTEXT, claimCandidates, claimKey, claimProbabilities, isSmallEdit, lineRequest, scriptRequests } from "../../lib/agent/claimScan";
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
//    its own: it belongs to the account's AI features. A line is asked about
//    once the caret has left it, never while it is being written; a small
//    edit later keeps its answer. Answers are kept per script on this device,
//    keyed by the line's text, so opening a script again asks nothing new.
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
/** Answers kept per script (only for lines the script still has). */
const ANSWERS_MAX = 1000;

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
  /** Line keys that took the answer of the line before a small edit. */
  inherited: Set<string>;
  /** Answers and resolved lines read from the device (once per entry). */
  loaded: Promise<void> | null;
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
  entry = { probabilities: new Map(), checks: new Map(), resolved: new Set(), inherited: new Set(), loaded: null };
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

export interface ScanInput {
  /** Editor keys of the blocks, same order: an edited line is recognized as
   *  the same line, so a small edit keeps its answer. */
  ids?: readonly string[];
  /** The line being written (caret in it): asked about once it is left. */
  editing?: number | null;
}

export interface ClaimScanner {
  /** The script was opened, a line was left or changed elsewhere. */
  update(blocks: readonly AgentBlock[], input?: ScanInput): void;
  dispose(): void;
}

/** Finds checkable lines of one open script: first what the device does not
 *  know yet, as one request with the whole script, then every new or
 *  rewritten line with its neighbours once the caret has left it. */
export function createClaimScanner(scriptId: string): ClaimScanner {
  const entry = () => claimsOf(scriptId);
  const pending = new Set<string>();
  const abort = new AbortController();
  /** Editor block -> the text that was last asked about (or known) for it. */
  const asked = new Map<string, string>();
  /** Keys of the script's checkable lines as last seen. */
  let lines: string[] = [];
  let pausedUntil = 0;
  let running = 0;
  let disposed = false;
  /** The first look at an opened script goes as one request. */
  let opened = false;

  const ask = async (blocks: readonly AgentBlock[], request: Parameters<typeof decide>[0], targets: readonly number[], ids: readonly string[] | undefined) => {
    const keys = targets.map((index) => claimKey(blocks[index].text));
    keys.forEach((key) => pending.add(key));
    running += 1;
    try {
      const answers = claimProbabilities(await decide(request, { signal: abort.signal }));
      const claims = entry();
      targets.forEach((index, i) => {
        // No answer counts as no claim: the line is not asked about again.
        claims.probabilities.set(keys[i], answers.get(index) ?? 0);
        claims.inherited.delete(keys[i]);
        const id = ids?.[index];
        if (id) asked.set(id, blocks[index].text);
      });
      bump();
      persistAnswers(scriptId, claims, lines);
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

  const scan = (blocks: readonly AgentBlock[], input: ScanInput) => {
    const claims = entry();
    const { probabilities, resolved, inherited } = claims;
    const candidates = claimCandidates(blocks);
    lines = candidates.map((index) => claimKey(blocks[index].text));
    const missing: number[] = [];
    let carried = false;
    let carriedResolved = false;
    candidates.forEach((index, n) => {
      if (index === input.editing) return;
      const key = lines[n];
      const id = input.ids?.[index];
      if (probabilities.has(key) || resolved.has(key)) {
        if (id && !inherited.has(key)) asked.set(id, blocks[index].text);
        return;
      }
      if (pending.has(key)) return;
      // A small edit of a line that was asked about keeps its answer; the
      // comparison stays with the asked text, so edits cannot add up.
      const before = id ? asked.get(id) : undefined;
      if (before !== undefined && isSmallEdit(before, blocks[index].text)) {
        const from = claimKey(before);
        const probability = probabilities.get(from);
        if (probability !== undefined) probabilities.set(key, probability);
        if (resolved.has(from)) {
          addResolved(claims, key);
          carriedResolved = true;
        }
        if (probability !== undefined || resolved.has(from)) {
          inherited.add(key);
          carried = true;
          return;
        }
      }
      missing.push(index);
    });
    if (carried) {
      bump();
      persistAnswers(scriptId, claims, lines);
      if (carriedResolved) persistResolved(scriptId, resolved);
    }
    const first = !opened;
    opened = true;
    if (missing.length === 0) return;
    if (first || missing.length > LINE_REQUESTS_MAX || running + missing.length > LINE_REQUESTS_MAX) {
      for (const request of scriptRequests(blocks, missing)) {
        const targets = Object.keys(request.questions).map((key) => Number(key.slice(1)));
        void ask(blocks, request, targets, input.ids);
      }
      return;
    }
    for (const index of missing) void ask(blocks, lineRequest(blocks, index), [index], input.ids);
  };

  return {
    update(blocks, input = {}) {
      if (disposed || !claimScanAllowed() || Date.now() < pausedUntil) return;
      // What the device knows comes first: an opened script asks only about
      // lines it has not seen.
      void loadClaims(scriptId).then(() => {
        if (!disposed && claimScanAllowed()) scan(blocks, input);
      });
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
    "Write the explanation and any reply in the language your instructions name for answers, not in the language of this request; a fix stays in the language of the script.",
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
const ANSWERS_KEY = (scriptId: string) => `script.${scriptId}.claims_scan`;

/** Reads the answers and resolved lines of a script from the device (once
 *  per session and script). Anything newer in memory stays. */
export function loadClaims(scriptId: string): Promise<void> {
  const entry = claimsOf(scriptId);
  entry.loaded ??= (async () => {
    // Nothing readable: lines are asked about or shown again, nothing is lost.
    const read = async (key: string): Promise<unknown> => {
      try {
        const raw = await getKvStore().getAppState(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    };
    const [resolved, answers] = await Promise.all([read(RESOLVED_KEY(scriptId)), read(ANSWERS_KEY(scriptId))]);
    if (Array.isArray(resolved)) for (const key of resolved) if (typeof key === "string") entry.resolved.add(key);
    if (answers && typeof answers === "object" && !Array.isArray(answers)) {
      for (const [key, value] of Object.entries(answers)) {
        if (typeof value === "number" && value >= 0 && value <= 1 && !entry.probabilities.has(key)) entry.probabilities.set(key, value);
      }
    }
    bump();
  })();
  return entry.loaded;
}

function addResolved(entry: ScriptClaims, key: string): void {
  entry.resolved.delete(key);
  entry.resolved.add(key);
  while (entry.resolved.size > RESOLVED_MAX) entry.resolved.delete(entry.resolved.values().next().value as string);
}

/** The user is done with a line: its mark and result leave the paper. */
export function resolveClaim(scriptId: string, text: string): void {
  const entry = claimsOf(scriptId);
  const key = claimKey(text);
  addResolved(entry, key);
  entry.checks.delete(key);
  bump();
  persistResolved(scriptId, entry.resolved);
}

/** Open write channels; older scripts' channels flush and close. */
const WRITERS_MAX = 4;
const writers = new Map<string, ReturnType<typeof createStatePersistence>>();

function persist(key: string, value: string): void {
  let writer = writers.get(key);
  if (!writer) {
    if (writers.size >= WRITERS_MAX) {
      const [oldest, old] = writers.entries().next().value as [string, ReturnType<typeof createStatePersistence>];
      old.dispose();
      writers.delete(oldest);
    }
    writer = createStatePersistence(getKvStore(), key);
    writers.set(key, writer);
  }
  writer.schedule(value);
}

function persistResolved(scriptId: string, resolved: ReadonlySet<string>): void {
  persist(RESOLVED_KEY(scriptId), JSON.stringify([...resolved]));
}

/** Keeps the answers for the lines the script has now (bounded with it). */
function persistAnswers(scriptId: string, entry: ScriptClaims, lines: readonly string[]): void {
  const out: Record<string, number> = {};
  let count = 0;
  for (const key of lines) {
    const probability = entry.probabilities.get(key);
    if (probability === undefined || key in out) continue;
    out[key] = Math.round(probability * 1000) / 1000;
    if (++count >= ANSWERS_MAX) break;
  }
  persist(ANSWERS_KEY(scriptId), JSON.stringify(out));
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
  writers.clear();
  bump();
}
