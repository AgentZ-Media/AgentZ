// Agent model benchmark: a demo of the app that runs on its own. For every
// demo profile (profiles/), model and repetition it seeds a fresh database
// (world.ts), sends the tasks (tasks.ts) through the app's real paths - the
// chat store with its instructions, tools, quotes, jobs and session lines,
// the fact check of a line, learning - and records what the user would see,
// every tool call and what OpenRouter billed. Results are appended to
// apps/bench/data/scriptz-agent.json; the bench app (pnpm dev:bench) shows
// them.
//
//   BENCH_MODELS=google/gemini-3.8-flash,openai/gpt-6.1-sol pnpm bench:agent
//
// Environment: BENCH_MODELS (OpenRouter ids, default: the app's model),
// BENCH_RUNS (repetitions, default 3), BENCH_PROFILES and BENCH_TASKS (ids,
// default all; a chosen task brings the earlier turns of its conversation),
// BENCH_JUDGE (judge model, default anthropic/claude-opus-5.5, "off" to
// skip), BENCH_REJUDGE=1 (only rate stored runs without a rating),
// BENCH_REHASH=1 (stored runs take the current prompt state, after changes
// that do not touch the prompts).
// Key: OPENROUTER_API_KEY, else .env.local in the repository root, else
// ~/.agentz-secrets/openrouter-api-key.
//
// The only stand-in is the provider: the stores get an OpenRouter harness
// (the app's own) with the model under test instead of the chosen one.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unwrap } from "solid-js/store";
import { describe, it, vi } from "vitest";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import { OPENROUTER_EFFORTS, OPENROUTER_MODEL } from "../lib/agent/openrouter/config";
import { OpenRouterProvider } from "../lib/agent/openrouter/provider";
import { TransportError, type OpenRouterTransport } from "../lib/agent/openrouter/transport";
import type { ChatItem } from "../lib/agent/chats";
import type { MemoryChange } from "../lib/agent/tools";
import { DEFAULT_EFFORT } from "../lib/agent/types";
import { memoryThreads } from "../lib/agent/__tests__/openrouterFakes";
import { agentSettings } from "../stores/agentSettings";
import { settingsStore } from "../stores/settings";
import { createChat } from "../stores/agent/chat";
import { checkClaim, lineState } from "../stores/agent/claims";
import { learnScript } from "../stores/agent/learning";
import type { ChatSession } from "../stores/agent/types";
import { agentz } from "./profiles/agentz";
import { pflege } from "./profiles/pflege";
import type { Profile } from "./profiles/types";
import { draftsOf, TASKS, type Check, type Task, type TaskResult, type Text, type ToolCall } from "./tasks";
import { context, createWorld, installPlatform, scriptId, seedContent, writeSettings, type World } from "./world";

vi.mock("../stores/agent/provider", async () => {
  const { currentWorld: world } = await import("./world");
  const { OPENROUTER_EFFORTS: efforts } = await import("../lib/agent/openrouter/config");
  const model = () => ({ id: world().model, label: world().model, description: "", efforts: [...efforts], defaultEffort: "medium", isDefault: true });
  const ready = { state: "ready", account: "bench" };
  return {
    getProvider: () => world().provider,
    currentProvider: () => world().provider,
    ensureModels: async () => [model()],
    refreshModels: async () => [model()],
    resolveModel: (list: unknown[]) => list[0],
    // Fact checks run on the model under test as well.
    resolveCheckModel: (list: unknown[]) => list[0],
    refreshStatus: async () => ready,
    status: () => ready,
    models: () => [model()],
    modelsLoading: () => false,
    hasAgentHost: () => true,
    hostedAccess: () => true,
    refreshHostedAccess: async () => true,
    openRouterKeyHint: () => null,
    setOpenRouterKey: async () => {},
    setAgentHost: () => {},
    clearAgentHost: () => {},
    disposeProvider: () => {},
    invalidateStatusCheck: () => {},
  };
});

const PROFILES: Profile[] = [agentz, pflege];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../..");
const RESULTS = join(REPO, "apps/bench/data/scriptz-agent.json");
const API = "https://openrouter.ai/api/v1";

type Obj = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? v as Obj : {});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY?.trim()) return process.env.OPENROUTER_API_KEY.trim();
  const roots = [REPO];
  try {
    roots.push(dirname(execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd: REPO }).toString().trim()));
  } catch {
    // Not a git checkout: only the repository root.
  }
  for (const root of roots) {
    const file = join(root, ".env.local");
    const line = existsSync(file) ? readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("OPENROUTER_API_KEY=")) : undefined;
    if (line) return line.slice("OPENROUTER_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
  }
  const secret = join(homedir(), ".agentz-secrets/openrouter-api-key");
  if (existsSync(secret)) return readFileSync(secret, "utf8").trim();
  throw new Error("no OpenRouter key: set OPENROUTER_API_KEY");
}

const KEY = apiKey();
const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "X-Title": "AgentZ Suite Bench" };

// ---------------------------------------------------------------- records

export interface StepLog {
  task: string;
  kind: "step" | "search";
  generationId: string | null;
  provider: string | null;
  /** Start, relative to the task's start. */
  atMs: number;
  ms: number;
  /** Time to the first streamed token (text, reasoning or tool call). */
  firstMs: number | null;
  /** When a draft block started to stream (relative to the task's start). */
  draftAtMs: number | null;
  toolCalls: { name: string; args: string }[];
  usage: Obj | null;
  /** total_cost from /api/v1/generation, once OpenRouter has it. */
  billedUsd: number | null;
  /** Error the stream reported (the harness retries such steps). */
  error: string | null;
}

type LiveStep = StepLog & { done?: Promise<void> };

/** One task of one model in one world. Format version 2, mirrored in
 *  apps/bench/src/data.ts. */
export interface BenchRun {
  id: string;
  batch: string;
  at: string;
  commit: string;
  profile: string;
  task: string;
  taskLabel: Text;
  model: string;
  modelName: string;
  effort: string;
  rep: number;
  /** Prompt state: the app's prompt and tool sources, the profile and the
   *  task's request. Runs with the same hash got the same prompts. */
  promptHash: string;
  pricing: Obj | null;
  status: "completed" | "failed";
  error?: string;
  ms: number;
  /** Until the user sees the result appear: card, draft or memory note. */
  firstOutputMs: number | null;
  steps: number;
  /** Model steps that broke off and were sent again. */
  failedSteps: number;
  searches: number;
  tokens: { prompt: number; cached: number; cacheWrite: number; completion: number; reasoning: number };
  costUsd: number;
  costSource: "generation" | "usage";
  searchCostUsd: number;
  items: ChatItem[];
  claim?: TaskResult["claim"];
  memoryChanges?: MemoryChange[];
  toolCalls: ToolCall[];
  checks: Check[];
  judge: { model: string; score: number; reason: Text; costUsd: number } | null;
  stepLog: StepLog[];
}

interface Library {
  profiles: unknown[];
  tasks: unknown[];
}

interface ResultsFile extends Library { version: 2; runs: BenchRun[] }

function readResults(): ResultsFile {
  if (!existsSync(RESULTS)) return { version: 2, profiles: [], tasks: [], runs: [] };
  const file = JSON.parse(readFileSync(RESULTS, "utf8")) as Partial<ResultsFile>;
  return { version: 2, profiles: file.profiles ?? [], tasks: file.tasks ?? [], runs: file.version === 2 ? file.runs ?? [] : [] };
}

// -------------------------------------------------------------- transport

interface TaskClock { task: string; startedAt: number }
const clocks = new WeakMap<World, Map<string, TaskClock>>();
const logs = new WeakMap<World, LiveStep[]>();

const abortError = () => new DOMException("aborted", "AbortError");

/** Settles like `promise`, or rejects as soon as the signal aborts. The test
 *  DOM replaces AbortSignal with one Node's fetch rejects, so the signal
 *  cannot go to fetch itself; this keeps the harness' turn timeout and
 *  interrupt working all the same. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(abortError());
    signal.addEventListener("abort", stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** A body that errors when the signal aborts, as a fetch body would. */
function abortable(source: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = () => {
        if (!open) return;
        open = false;
        controller.error(abortError());
        void reader.cancel().catch(() => {});
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    },
    async pull(controller) {
      const { value, done } = await reader.read();
      if (!open) return;
      if (done) {
        open = false;
        controller.close();
      } else controller.enqueue(value);
    },
    cancel(reason) {
      open = false;
      return reader.cancel(reason);
    },
  });
}

/** Same request shaping as the hosted proxy (apps/site/convex/ai.ts,
 *  upstreamBody) with the world's model; logs every request. Errors behave
 *  like the app's transports: TransportError with the HTTP status (429 and
 *  5xx are retried by the harness, status 0 for the network). */
function benchTransport(): OpenRouterTransport {
  return {
    check: async () => ({ state: { state: "ready", account: "bench" }, model: null, checkModel: null }),
    async complete(body, signal) {
      const ctx = context.getStore();
      if (!ctx?.task) throw new Error("request outside a task");
      const world = ctx.world;
      const clock = clocks.get(world)?.get(ctx.task);
      const startedAt = clock?.startedAt ?? performance.now();
      const upstream: Obj = { ...body, model: world.model, user: "agentz-bench", max_tokens: 32_000 };
      if (body.stream) upstream.usage = { include: true };
      if (Array.isArray(body.plugins)) upstream.plugins = [{ id: "web", engine: "exa", max_results: 5 }];
      const sent = performance.now();
      const entry: LiveStep = {
        task: ctx.task, kind: body.stream ? "step" : "search", generationId: null, provider: null,
        atMs: Math.round(sent - startedAt), ms: 0, firstMs: null, draftAtMs: null, toolCalls: [], usage: null, billedUsd: null, error: null,
      };
      logs.get(world)?.push(entry);
      const fail = (message: string) => {
        entry.ms = Math.round(performance.now() - sent);
        entry.error = message;
      };
      let response: Response;
      try {
        response = await untilAborted(fetch(`${API}/chat/completions`, { method: "POST", headers, body: JSON.stringify(upstream) }), signal);
      } catch (error) {
        if (signal.aborted) {
          fail("aborted");
          throw error;
        }
        fail(`network: ${error instanceof Error ? error.message : String(error)}`);
        throw new TransportError("network", 0);
      }
      if (!response.ok || !response.body) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        fail(`HTTP ${response.status}: ${detail}`);
        throw new TransportError(detail || `request failed (${response.status})`, response.status);
      }
      if (!body.stream) {
        const json = obj(await untilAborted(response.json(), signal));
        entry.ms = Math.round(performance.now() - sent);
        entry.usage = obj(json.usage);
        entry.generationId = typeof json.id === "string" ? json.id : null;
        entry.provider = typeof json.provider === "string" ? json.provider : null;
        entry.toolCalls.push({ name: "web_search", args: JSON.stringify({ query: obj(Array.isArray(body.messages) ? body.messages.at(-1) : null).content }) });
        return new Response(JSON.stringify(json), { status: 200 });
      }
      const [forHarness, forLog] = abortable(response.body, signal).tee();
      entry.done = readStream(forLog, entry, sent, startedAt).catch(() => {
        if (!entry.error) fail(signal.aborted ? "aborted" : "stream broke off");
      });
      return new Response(forHarness, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    },
  };
}

async function readStream(stream: ReadableStream<Uint8Array>, entry: StepLog, sent: number, startedAt: number): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const calls = new Map<number, { name: string; args: string }>();
  let content = "";
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:") || line.endsWith("[DONE]")) continue;
      let chunk: Obj;
      try {
        chunk = obj(JSON.parse(line.slice(5)));
      } catch {
        continue;
      }
      const error = obj(chunk.error);
      if (Object.keys(error).length) entry.error = `${String(error.code ?? "")} ${String(error.message ?? "stream error")}`.trim();
      const delta = obj(obj(Array.isArray(chunk.choices) ? chunk.choices[0] : null).delta);
      if (entry.firstMs === null && (delta.content || delta.reasoning || delta.tool_calls)) entry.firstMs = Math.round(performance.now() - sent);
      if (typeof delta.content === "string") {
        content += delta.content;
        if (entry.draftAtMs === null && content.includes(":::draft")) entry.draftAtMs = Math.round(performance.now() - startedAt);
      }
      for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const piece = obj(raw);
        const index = typeof piece.index === "number" ? piece.index : calls.size;
        const fn = obj(piece.function);
        const call = calls.get(index) ?? { name: "", args: "" };
        if (typeof fn.name === "string") call.name += fn.name;
        if (typeof fn.arguments === "string") call.args += fn.arguments;
        calls.set(index, call);
      }
      if (typeof chunk.id === "string") entry.generationId = chunk.id;
      if (typeof chunk.provider === "string") entry.provider = chunk.provider;
      if (chunk.usage) entry.usage = obj(chunk.usage);
    }
  }
  entry.ms = Math.round(performance.now() - sent);
  if (!entry.error && !entry.usage) entry.error = "stream ended without an answer";
  entry.toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c).filter((c) => c.name);
}

// ---------------------------------------------------------------- running

interface Pending { task: Task; result: TaskResult; ms: number; status: "completed" | "failed"; error?: string }


/** Waits until a chat has loaded (its items come from the database). */
async function ready(chat: ChatSession): Promise<void> {
  for (let i = 0; i < 200 && !chat.ready(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
}

async function runConversation(world: World, tasks: Task[]): Promise<Pending[]> {
  const first = tasks[0];
  let chat: ChatSession | null = null;
  let previousItems: ChatItem[] = [];
  const out: Pending[] = [];
  for (const task of tasks) {
    const clock: TaskClock = { task: task.id, startedAt: performance.now() };
    clocks.get(world)?.set(task.id, clock);
    const result: TaskResult = { items: [], toolCalls: [], previousItems };
    let status: Pending["status"] = "completed";
    let error: string | undefined;
    try {
      await context.run({ world, task: task.id }, async () => {
        clock.startedAt = performance.now();
        const request = task.request(world);
        if (request.kind === "chat") {
          if (!chat) {
            chat = first.mode === "session"
              ? createChat({ kind: "session", chatId: crypto.randomUUID(), folderId: world.folders.get(first.folder ?? "") ?? null })
              : createChat({ kind: "script", scriptId: scriptId(world, first.script ?? ""), record: null });
            await ready(chat);
          }
          // New items by id: sending drops the reply chips of the turn before,
          // so the list does not just grow at the end.
          const before = new Set(chat.items.map((item) => item.id));
          await chat.send(request.text, request.quote, request.options);
          await chat.flush().catch(() => {});
          result.items = clone(unwrap(chat.items).filter((item) => !before.has(item.id)));
          const failure = result.items.find((i) => i.kind === "error");
          if (failure?.kind === "error") throw new Error(failure.message);
        } else if (request.kind === "claim") {
          const id = scriptId(world, task.script ?? "");
          await checkClaim(id, request.index, request.text);
          const check = lineState(id, request.text).check;
          if (check?.state === "failed") throw new Error(check.error);
          result.claim = check?.state === "done" ? { claim: clone(check.claim), note: check.note } : { claim: null, note: "" };
        } else {
          const changes = await learnScript(scriptId(world, task.script ?? ""));
          result.memoryChanges = clone(changes ?? []);
          result.items = (changes ?? []).map((change, i) => ({ kind: "memory", id: `learn-${i}`, action: change.action, entry: change.entry, ...(change.action === "updated" ? { previous: change.previous } : {}) }) as ChatItem);
        }
      });
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? e.message : String(e);
    }
    const ms = Math.round(performance.now() - clock.startedAt);
    out.push({ task, result, ms, status, error });
    previousItems = result.items;
    if (status === "failed") break;
  }
  return out;
}

async function runWorld(world: World): Promise<Pending[]> {
  const conversations = (phase: 1 | 2) => {
    const tasks = TASKS.filter((t) => t.profile === world.profile.id && t.phase === phase && selected(t));
    return [...new Set(tasks.map((t) => t.conversation))].map((c) => tasks.filter((t) => t.conversation === c));
  };
  const first = await Promise.all(conversations(1).map((c) => runConversation(world, c)));
  // Tasks that write memory one after another: each sees only its own changes.
  const second: Pending[][] = [];
  for (const c of conversations(2)) second.push(await runConversation(world, c));
  return [...first, ...second].flat();
}

/** Tasks before `task` in its conversation (the turns it builds on). */
function predecessors(task: Task): Task[] {
  const same = TASKS.filter((t) => t.profile === task.profile && t.conversation === task.conversation);
  return same.slice(0, same.indexOf(task));
}

/** BENCH_TASKS, plus the earlier turns every chosen task builds on: a
 *  revision never runs without its draft. */
function selected(task: Task): boolean {
  const only = process.env.BENCH_TASKS?.split(",").map((t) => t.trim()).filter(Boolean);
  if (!only?.length) return true;
  return TASKS.some((t) => only.includes(t.id) && (t === task || predecessors(t).includes(task)));
}

// ------------------------------------------------------- cost and judging

async function billedCost(generationId: string): Promise<number | null> {
  // OpenRouter needs a moment until a generation can be looked up.
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const response = await fetch(`${API}/generation?id=${encodeURIComponent(generationId)}`, { headers }).catch(() => null);
    if (!response?.ok) continue;
    const data = obj(obj(await response.json()).data);
    if (typeof data.total_cost === "number") return data.total_cost;
  }
  return null;
}

const VERDICT_DE: Record<string, string> = { correct: "stimmt", imprecise: "ungenau", wrong: "falsch", unclear: "unklar" };
const blockLines = (blocks: { type: string; text: string }[]) => blocks.map((b) => `${b.type.toUpperCase()}: ${b.text}`).join("\n");

/** What the user sees, as plain text for the judge. */
function describeRun(run: BenchRun, wpm: number): string {
  const parts: string[] = [];
  for (const item of run.items) {
    if (item.kind === "assistant") {
      // Drafts in progress notes count as well: the draft panel shows every
      // draft of the chat (collectDrafts).
      const drafts = draftsOf([item], wpm);
      const text = item.text.replace(/:::draft[\s\S]*?:::/g, "").trim();
      if (text) parts.push(`${item.commentary ? "Zwischennotiz" : "Antwort im Chat"}: ${text}`);
      for (const d of drafts) parts.push(`Entwurf "${d.title}" (im Entwurfs-Panel):\n${d.lines.join("\n")}`);
    } else if (item.kind === "proposal") {
      parts.push(`Vorschlagskarte (Ziel ${JSON.stringify({ ...item.proposal.target, anchor: undefined })}):\n${item.proposal.options.map((o, i) => `Option ${i + 1}: ${o.title}${o.note ? ` (${o.note})` : ""}\n${blockLines(o.blocks)}`).join("\n\n")}`);
    } else if (item.kind === "claims") {
      for (const c of item.claims) parts.push(`Faktencheck: ${VERDICT_DE[c.verdict]} - ${c.explanation}`);
    } else if (item.kind === "memory") {
      parts.push(`Gedächtnis ${item.action}: [${item.entry.kind}${item.entry.subject ? ` ${item.entry.subject}` : ""}] ${item.entry.content}`);
    } else if (item.kind === "ideas") {
      parts.push(`Ideenkarten:\n${item.ideas.map((idea, i) => `${i + 1}. ${idea.title}: ${idea.premise}${idea.hook ? ` Hook: ${idea.hook}` : ""} [${idea.characters.join(", ")}]`).join("\n")}`);
    } else if (item.kind === "replies") {
      parts.push(`Antwortvorschläge: ${item.replies.join(" | ")}`);
    }
  }
  if (run.claim) {
    const c = run.claim.claim;
    parts.push(c
      ? `Faktencheck-Karte: "${c.quote}"\nUrteil: ${VERDICT_DE[c.verdict]}\nErklärung: ${c.explanation}\nQuellen: ${c.sources.map((s) => s.url).join(", ") || "keine"}${c.fix ? `\nKorrektur:\n${blockLines(c.fix.blocks)}` : ""}`
      : "Keine Faktencheck-Karte.");
    if (run.claim.note) parts.push(`Notiz: ${run.claim.note}`);
  }
  if (run.memoryChanges && !run.memoryChanges.length) parts.push("Nichts gelernt.");
  parts.push(`Tool-Aufrufe: ${run.toolCalls.map((c) => c.name).join(", ") || "keine"}`);
  return parts.join("\n\n");
}

const JUDGE_SYSTEM = `Du bewertest die Arbeit eines KI-Schreibpartners in ScriptZ, einer App für kurze Comedy-Skripte (TikTok, Reels, YouTube). Du siehst den Nutzer, seinen Ordner mit Beispielskripten, das Gedächtnis des Agenten, den Auftrag und das, was der Nutzer in der App sieht. Achte besonders darauf, ob Stil, Figurenstimmen und Regeln aus den Daten des Nutzers getroffen werden. Bewerte streng und konsistent von 1 bis 10 (10 = besser geht es kaum, 5 = brauchbar mit klaren Schwächen, 1 = unbrauchbar). Antworte nur mit JSON: {"score": <Zahl>, "reason_de": "<1-2 Sätze auf Deutsch>", "reason_en": "<dieselbe Begründung auf Englisch>"}.`;

/** The turns before `run` in its conversation and world, as the user saw
 *  them: "Schreib Nummer 2" needs the idea board, a revision its draft. */
function historyFor(run: BenchRun, all: readonly BenchRun[], tasks: Library["tasks"]): string {
  const task = TASKS.find((t) => t.id === run.task);
  if (!task) return "";
  const prefix = run.id.slice(0, run.id.length - run.task.length);
  const wpm = Number(PROFILES.find((p) => p.id === task.profile)?.settings.dialog_wpm ?? 160);
  return predecessors(task).map((before) => {
    const earlier = all.find((r) => r.id === `${prefix}${before.id}`);
    return earlier ? `Nutzer: ${requestText(tasks, before.id)}\n${describeRun(earlier, wpm)}` : "";
  }).filter(Boolean).join("\n\n");
}

function judgePrompt(task: Task, run: BenchRun, request: string, history: string): string {
  const profile = PROFILES.find((p) => p.id === task.profile)!;
  const folderKey = task.folder ?? profile.scripts.find((s) => s.key === task.script)?.folder;
  const folder = profile.folders.find((f) => f.key === folderKey);
  const scripts = profile.scripts.filter((s) => s.folder === folderKey);
  const open = profile.scripts.find((s) => s.key === task.script);
  const examples = scripts.filter((s) => s.key !== open?.key && s.stage !== "writing").slice(0, 3);
  const memory = profile.memory.filter((m) => m.folder === null || m.folder === folderKey).map((m) => `- [${m.kind}${m.subject ? ` ${m.subject}` : ""}] ${m.content}`);
  return [
    `Nutzer: ${profile.about.de}`,
    `Ordner "${folder?.name}" (Längenziel ${folder?.minSec ?? "-"}-${folder?.maxSec ?? "-"} s). Beispielskripte:\n${examples.map((s) => `"${s.title}":\n${s.body}`).join("\n\n")}`,
    `Gedächtnis des Agenten:\n${memory.join("\n")}`,
    open ? `Betroffenes Skript "${open.title}":\n${open.body}` : "",
    history ? `Bisheriger Verlauf dieses Gesprächs (zum Verständnis, nicht bewerten):\n${history}` : "",
    `Auftrag (so sieht ihn der Nutzer): ${request}`,
    `Worauf es ankommt: ${task.rubric}`,
    `Ergebnis:\n${describeRun(run, Number(profile.settings.dialog_wpm ?? 160))}`,
  ].filter(Boolean).join("\n\n");
}

async function judge(judgeModel: string, run: BenchRun, request: string, history: string): Promise<void> {
  const task = TASKS.find((t) => t.id === run.task);
  if (!task || run.status !== "completed") return;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(`${API}/chat/completions`, {
        method: "POST", headers,
        body: JSON.stringify({ model: judgeModel, messages: [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: judgePrompt(task, run, request, history) }], max_tokens: 2000, usage: { include: true } }),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        // Rate limits, server errors and credits being topped up (402 while
        // requests are in flight): wait, then try again.
        if (response.status === 402 || response.status === 429 || response.status >= 500) {
          await new Promise((resolve) => setTimeout(resolve, (response.status === 402 ? 20_000 : 3000) * attempt));
        }
        throw new Error(`HTTP ${response.status}: ${detail}`);
      }
      const body = obj(await response.json());
      const text = String(obj(obj(Array.isArray(body.choices) ? body.choices[0] : null).message).content ?? "");
      const parsed = obj(JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? "null"));
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) throw new Error(`no score in: ${text.slice(0, 200)}`);
      run.judge = { model: judgeModel, score, reason: { de: String(parsed.reason_de ?? ""), en: String(parsed.reason_en ?? "") }, costUsd: num(obj(body.usage).cost) };
      return;
    } catch (error) {
      console.warn(`[bench] judging ${run.model} ${run.task} failed (attempt ${attempt})`, error instanceof Error ? error.message : error);
    }
  }
}

/** Runs `fn` over `items` with at most `size` at a time. */
async function pool<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Rates every completed run without a rating, with its conversation. */
async function judgeAll(judgeModel: string, runs: BenchRun[], all: readonly BenchRun[], tasks: Library["tasks"]): Promise<void> {
  await pool(runs.filter((run) => !run.judge && run.status === "completed"), 3, (run) => judge(judgeModel, run, requestText(tasks, run.task), historyFor(run, all, tasks)));
}

// ---------------------------------------------------------------- library

/** Profiles and tasks of the profiles in `worlds`, as the bench app shows
 *  them (current definitions). */
function library(worlds: Map<string, World>): Library {
  const profiles = PROFILES.filter((p) => worlds.has(p.id)).map((p) => ({
    id: p.id, name: p.name, about: p.about,
    persona: { name: p.settings["agent.name"], userName: p.settings["agent.user_name"], traits: JSON.parse(p.settings["agent.traits"] ?? "[]") as string[], instructions: p.settings["agent.instructions"] ?? "" },
    wpm: Number(p.settings.dialog_wpm ?? 160),
    folders: p.folders,
    scripts: p.scripts.map((s) => ({ key: s.key, title: s.title, folder: s.folder, stage: s.stage, body: s.body })),
    memory: p.memory,
    ideas: p.ideas,
  }));
  const tasks = TASKS.filter((t) => worlds.has(t.profile)).map((t) => {
    const request = t.request(worlds.get(t.profile)!);
    return {
      id: t.id, profile: t.profile, label: t.label, mode: t.mode, script: t.script ?? null, folder: t.folder ?? null, rubric: t.rubric,
      message: request.kind === "chat" || request.kind === "claim" ? request.text : null,
      quote: request.kind === "chat" ? request.quote?.text ?? null : null,
      instruction: request.kind === "chat" ? request.options?.instruction ?? null : null,
      lineIndex: request.kind === "claim" ? request.index : null,
    };
  });
  return { profiles, tasks };
}

/** Entries of `next` replace those with the same id; the rest stays (a run
 *  of one profile keeps the others' descriptions). */
function merge(stored: unknown[], next: unknown[]): unknown[] {
  const ids = new Set(next.map((entry) => obj(entry).id));
  return [...stored.filter((entry) => !ids.has(obj(entry).id)), ...next];
}

function requestText(tasks: Library["tasks"], id: string): string {
  const task = obj(tasks.find((t) => obj(t).id === id));
  const quote = task.quote ? `\nAusgewählt:\n${String(task.quote)}` : "";
  return `${String(task.message ?? (task.mode === "learn" ? "Lernen aus dem fertigen Skript" : ""))}${quote}`;
}

// ---------------------------------------------------------- prompt state

/** Sources that shape what a model sees: instructions, tools, jobs, how the
 *  chat, the fact check and learning compose their messages, the harness. */
const PROMPT_SOURCES = [
  "lib/agent/prompt.ts", "lib/agent/tools.ts", "lib/agent/sessionTools.ts", "lib/agent/jobs.ts", "lib/agent/writingContext.ts",
  "lib/agent/openrouter/provider.ts", "stores/agent/instructions.ts", "stores/agent/chat.ts", "stores/agent/claims.ts", "stores/agent/learning.ts",
];
const promptStates = new Map<string, string>();

/** Deterministic, without a model call: the same sources, profile and
 *  request give the same state (ids that differ per world are masked). */
function notePromptStates(world: World): void {
  const sources = PROMPT_SOURCES.map((file) => readFileSync(join(HERE, "..", file), "utf8")).join("\n");
  const profile = JSON.stringify(world.profile);
  for (const task of TASKS.filter((t) => t.profile === world.profile.id)) {
    // The earlier turns of the conversation belong to the request.
    const requests = [...predecessors(task), task].map((t) => t.request(world));
    promptStates.set(task.id, hash(sources + profile + JSON.stringify(requests).replace(UUID, "<id>")));
  }
}

/** Fresh worlds of one profile, seeded, with the settings stores loaded. */
async function prepareProfile(profile: Profile, models: string[], reps: number): Promise<World[]> {
  applyResolvedLanguage(profile.language);
  const worlds = models.flatMap((model) => Array.from({ length: reps }, (_, i) => createWorld(profile, model, i + 1)));
  for (const world of worlds) {
    clocks.set(world, new Map());
    logs.set(world, []);
    await writeSettings(world);
  }
  await context.run({ world: worlds[0], task: null }, () => Promise.all([settingsStore.load(), agentSettings.load()]));
  for (const world of worlds) await seedContent(world);
  notePromptStates(worlds[0]);
  return worlds;
}

// ------------------------------------------------------------------ main

async function modelInfo(): Promise<Map<string, Obj>> {
  const response = await fetch(`${API}/models`);
  const list = response.ok ? obj(await response.json()).data : [];
  return new Map((Array.isArray(list) ? list : []).map((m) => [String(obj(m).id), obj(m)]));
}

function commit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: REPO }).toString().trim();
  } catch {
    return "unknown";
  }
}

function toRun(world: World, p: Pending, info: Map<string, Obj>, batch: string, head: string): BenchRun {
  const raw = (logs.get(world) ?? []).filter((s) => s.task === p.task.id).map(({ done: _done, ...rest }) => rest);
  // Fact checks wait in the app's check queue, one per app; in the
  // benchmark every world shares it. Their time counts from the first
  // request to the model.
  const queued = p.task.mode === "claim" && raw.length ? Math.min(...raw.map((s) => s.atMs)) : 0;
  const steps = raw.map((s) => ({ ...s, atMs: s.atMs - queued, draftAtMs: s.draftAtMs === null ? null : s.draftAtMs - queued }));
  const sum = (pick: (u: Obj) => unknown) => steps.reduce((total, s) => total + num(s.usage ? pick(s.usage) : 0), 0);
  const billed = steps.length > 0 && steps.every((s) => s.billedUsd !== null);
  const cost = (s: StepLog) => (billed ? s.billedUsd ?? 0 : num(s.usage?.cost));
  const toolCalls: ToolCall[] = steps.flatMap((s) => s.toolCalls.map((c) => ({ ...c, atMs: s.atMs + s.ms })));
  const cardAt = toolCalls.find((c) => /^(propose_options|propose_ideas|report_fact_check|remember|update_memory)$/.test(c.name))?.atMs ?? null;
  const draftAt = steps.find((s) => s.draftAtMs !== null)?.draftAtMs ?? null;
  const firsts = [cardAt, draftAt].filter((v): v is number => v !== null);
  const meta = info.get(world.model);
  const result: TaskResult = { ...p.result, toolCalls };
  return {
    id: `${batch}|${world.id}|${p.task.id}`,
    batch, at: new Date().toISOString(), commit: head,
    profile: world.profile.id, task: p.task.id, taskLabel: p.task.label,
    model: world.model, modelName: String(meta?.name ?? world.model).replace(/^[^:]+:\s*/, ""), effort: agentSettings.effort(), rep: world.rep,
    promptHash: promptStates.get(p.task.id) ?? "",
    pricing: meta ? obj(meta.pricing) : null,
    status: p.status, ...(p.error ? { error: p.error } : {}),
    ms: p.ms - queued, firstOutputMs: firsts.length ? Math.min(...firsts) : null,
    steps: steps.filter((s) => s.kind === "step").length,
    failedSteps: steps.filter((s) => s.error).length,
    searches: steps.filter((s) => s.kind === "search").length,
    tokens: {
      prompt: sum((u) => u.prompt_tokens),
      cached: sum((u) => obj(u.prompt_tokens_details).cached_tokens),
      cacheWrite: sum((u) => obj(u.prompt_tokens_details).cache_write_tokens),
      completion: sum((u) => u.completion_tokens),
      reasoning: sum((u) => obj(u.completion_tokens_details).reasoning_tokens),
    },
    costUsd: steps.reduce((total, s) => total + cost(s), 0),
    costSource: billed ? "generation" : "usage",
    searchCostUsd: steps.filter((s) => s.kind === "search").reduce((total, s) => total + cost(s), 0),
    items: p.result.items.map((item) => (item.kind === "thinking" ? { ...item, text: item.text.slice(0, 4000) } : item)),
    ...(p.result.claim ? { claim: p.result.claim } : {}),
    ...(p.result.memoryChanges ? { memoryChanges: p.result.memoryChanges } : {}),
    toolCalls,
    checks: p.status === "completed" ? p.task.checks(result, world) : [],
    judge: null,
    stepLog: steps,
  };
}

describe("agent model benchmark", () => {
  it("runs the demo profiles and appends the results", async () => {
    installPlatform();
    const judgeModel = process.env.BENCH_JUDGE ?? "anthropic/claude-opus-5.5";

    if (process.env.BENCH_REJUDGE === "1") {
      // Only rate stored runs that have no rating yet; nothing new is run.
      const results = readResults();
      const missing = results.runs.filter((run) => !run.judge && run.status === "completed");
      await judgeAll(judgeModel, missing, results.runs, results.tasks);
      writeFileSync(RESULTS, `${JSON.stringify(results, null, 1)}\n`);
      console.log(`${missing.filter((run) => run.judge).length} of ${missing.length} runs rated`);
      return;
    }

    if (process.env.BENCH_REHASH === "1") {
      // After a change that does not touch the prompts (bench code, checks):
      // stored runs take the current prompt state.
      for (const profile of PROFILES) await prepareProfile(profile, ["rehash"], 1);
      const results = readResults();
      for (const run of results.runs) run.promptHash = promptStates.get(run.task) ?? run.promptHash;
      writeFileSync(RESULTS, `${JSON.stringify(results, null, 1)}\n`);
      console.log(`${results.runs.length} runs set to the current prompt state`);
      return;
    }

    const models = (process.env.BENCH_MODELS ?? OPENROUTER_MODEL).split(",").map((m) => m.trim()).filter(Boolean);
    const reps = Math.max(1, Number(process.env.BENCH_RUNS ?? 3));
    const onlyProfiles = process.env.BENCH_PROFILES?.split(",").map((p) => p.trim()).filter(Boolean);
    const profiles = PROFILES.filter((p) => !onlyProfiles?.length || onlyProfiles.includes(p.id));
    const info = await modelInfo();
    for (const model of models) if (!info.has(model)) throw new Error(`unknown OpenRouter model: ${model}`);
    const batch = new Date().toISOString();
    const head = commit();
    const runs: BenchRun[] = [];
    const sample = new Map<string, World>();

    // Profiles one after another: the settings stores hold one profile.
    for (const profile of profiles) {
      const worlds = await prepareProfile(profile, models, reps);
      for (const world of worlds) {
        world.provider = new OpenRouterProvider("agentz", benchTransport(), memoryThreads().store);
        (world.provider as OpenRouterProvider).model = { id: world.model, label: world.model };
      }
      sample.set(profile.id, worlds[0]);
      console.log(`[bench] ${profile.id}: ${worlds.length} worlds, effort ${agentSettings.effort() || DEFAULT_EFFORT} (${OPENROUTER_EFFORTS.join("/")})`);

      const done = await Promise.all(worlds.map(async (world) => ({ world, pending: await runWorld(world) })));
      for (const { world, pending } of done) {
        const log = logs.get(world) ?? [];
        await Promise.all(log.map((entry) => entry.done));
        await pool(log.filter((entry) => entry.generationId), 16, async (entry) => {
          entry.billedUsd = await billedCost(entry.generationId!);
        });
        runs.push(...pending.map((p) => toRun(world, p, info, batch, head)));
      }
    }

    const results = readResults();
    const lib = library(sample);
    results.profiles = merge(results.profiles, lib.profiles);
    results.tasks = merge(results.tasks, lib.tasks);
    if (judgeModel !== "off") await judgeAll(judgeModel, runs, runs, results.tasks);
    results.runs.push(...runs);
    writeFileSync(RESULTS, `${JSON.stringify(results, null, 1)}\n`);
    for (const run of runs) {
      const passed = run.checks.filter((c) => c.pass).length;
      console.log([
        run.model.padEnd(26), run.task.padEnd(16), `#${run.rep}`, run.status.padEnd(9),
        `${(run.costUsd * 100).toFixed(2)} ct`, `${(run.ms / 1000).toFixed(1)} s`,
        `checks ${passed}/${run.checks.length}`, run.judge ? `judge ${run.judge.score}` : "", run.error ?? "",
      ].join("  "));
    }
    console.log(`${runs.length} runs appended to ${RESULTS}`);
  }, 2 * 60 * 60 * 1000);
});
