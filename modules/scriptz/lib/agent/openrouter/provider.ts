// OpenRouter harness: the agent loop that Codex app-server runs for the
// Codex provider, run inside the app. It takes the same instructions and the
// same tools (lib/agent/tools.ts, sessionTools.ts) and emits the same
// AgentEvents, so chat, learning and UI cannot tell the providers apart:
//
// - one turn = model steps until the model answers without tool calls; tool
//   calls run locally, their results go back to the model,
// - text and reasoning stream as deltas; text written next to tool calls is
//   a progress note (commentary), like Codex' commentary phase,
// - web search is a tool the model calls itself (like Codex' live search),
//   answered by a separate request with OpenRouter's web plugin,
// - threads keep their transcript (agent_threads), so a chat resumes with
//   its full history; ephemeral threads (learning) are never stored,
// - interrupt, a turn timeout and a step limit end runaway turns.
//
// Requests go through a transport (transport.ts): the hosted suite backend
// or OpenRouter with the user's own key. The harness does not care which.

import { localeCompare } from "@agentz/kit/i18n";
import { obj, type Obj } from "../toolArgs";
import {
  DEFAULT_EFFORT,
  type AgentEffort,
  type AgentEvent,
  type AgentModel,
  type AgentProvider,
  type AgentThread,
  type AgentTool,
  type OpenThreadOptions,
  type ProviderState,
  type ToolResult,
  type TurnOptions,
  type TurnResult,
} from "../types";
import type { ThreadRecord } from "../storage";
import { OPENROUTER_EFFORTS, OPENROUTER_MODEL, OPENROUTER_MODEL_LABEL, WEB_SEARCH_PLUGIN } from "./config";
import { readStep, StreamError, type StepResult, type WireToolCall } from "./stream";
import { TransportError, type OpenRouterTransport, type TransportModel } from "./transport";

export type WireMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: WireToolCall[]; reasoning_details?: Obj[]; model?: string }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ThreadStoreLike {
  get(id: string): Promise<ThreadRecord | null>;
  save(record: ThreadRecord): Promise<void>;
  prune(keep: number): Promise<void>;
}

/** `ThreadRecord.provider` of harness transcripts. Hosted and own key share
 *  them: switching between the two keeps the conversation. */
export const THREAD_KIND = "openrouter";

/** Abort a turn that runs away (the model can loop); same as Codex. */
const TURN_TIMEOUT_MS = 6 * 60 * 1000;
/** Model steps per turn (each step may call several tools). */
const MAX_STEPS = 40;
/** Transcripts kept on the device; older ones are pruned. */
const THREADS_KEPT = 300;
/** Context kept per request, in characters (about 300k tokens). Older tool
 *  output goes first, then the oldest turns, like Codex' compaction. */
const CONTEXT_BUDGET_CHARS = 1_200_000;
/** Messages at the end that are never shortened. */
const CONTEXT_KEEP_RECENT = 24;
/** Waits before retrying a request that failed on the way (Codex retries
 *  such errors itself). Only while nothing of the step was shown yet. */
const RETRY_DELAYS_MS = [1000, 3000];

export const WEB_SEARCH_TOOL = "web_search";

const WEB_SEARCH_DEFINITION = {
  type: "function",
  function: {
    name: WEB_SEARCH_TOOL,
    description: "Search the web for current, real-world information. Returns the relevant findings with their source URLs. Use short, specific queries; search again for follow-up questions.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search query." } },
      required: ["query"],
    },
  },
} as const;

const SEARCH_INSTRUCTIONS = "You are the web search tool of a writing assistant. Answer the query only from the current web results: the relevant facts as short bullet points, each followed by the URL of its source. If the results do not answer the query, say so plainly. Answer in the language of the query.";

/** Prompt caching: the instructions and the newest message carry a cache
 *  breakpoint, so the stable prefix (instructions + history) is billed at
 *  the cache rate on the next step and the next turn. */
const CACHE = { type: "ephemeral" } as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function messageChars(message: WireMessage): number {
  let n = message.content.length;
  if (message.role === "assistant") {
    for (const call of message.tool_calls ?? []) n += call.function.arguments.length + call.function.name.length;
    // Sent back with every request (thought signatures), so they count.
    if (message.reasoning_details?.length) n += JSON.stringify(message.reasoning_details).length;
  }
  return n;
}

/** Shortens the transcript in place until it fits the context budget. */
export function compact(messages: WireMessage[], budget = CONTEXT_BUDGET_CHARS): void {
  let total = messages.reduce((sum, m) => sum + messageChars(m), 0);
  if (total <= budget) return;
  const protectedFrom = Math.max(0, messages.length - CONTEXT_KEEP_RECENT);
  for (let i = 0; i < protectedFrom && total > budget; i++) {
    const message = messages[i];
    if (message.role !== "tool" || message.content.length <= 400) continue;
    const short = "[older tool output omitted to save context]";
    total -= message.content.length - short.length;
    message.content = short;
  }
  // Still too long: drop the oldest turns (a turn starts with a user message).
  while (total > budget) {
    const next = messages.findIndex((m, i) => i > 0 && m.role === "user");
    if (next <= 0 || next >= protectedFrom) break;
    total -= messages.slice(0, next).reduce((sum, m) => sum + messageChars(m), 0);
    messages.splice(0, next);
  }
}

/** After an interrupted or failed step every tool call still needs an
 *  answer, or the next request is rejected. */
export function repair(messages: WireMessage[]): void {
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.tool_calls?.length) continue;
    const answered = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      answered.add((messages[j] as { tool_call_id: string }).tool_call_id);
      j++;
    }
    const missing = message.tool_calls.filter((call) => !answered.has(call.id));
    if (missing.length === 0) continue;
    messages.splice(j, 0, ...missing.map((call): WireMessage => ({
      role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "interrupted" }),
    })));
  }
}

export function parseMessages(json: string): WireMessage[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((m): m is WireMessage => {
      const role = obj(m).role;
      return (role === "user" || role === "assistant" || role === "tool") && typeof obj(m).content === "string";
    });
  } catch {
    return [];
  }
}

/** The request form of the transcript: instructions first, cache
 *  breakpoints on the instructions and the newest message. Reasoning details
 *  go back only to the model that wrote them (a chat switches models for a
 *  fact check, transcripts outlive a model change); the stored model never
 *  goes upstream. */
export function requestMessages(instructions: string, messages: readonly WireMessage[], model = ""): Obj[] {
  const out: Obj[] = [{ role: "system", content: [{ type: "text", text: instructions, cache_control: CACHE }] }];
  messages.forEach((message, i) => {
    const last = i === messages.length - 1;
    if (last && message.role !== "assistant" && message.content) {
      out.push({ ...message, content: [{ type: "text", text: message.content, cache_control: CACHE }] });
    } else if (message.role === "assistant") {
      const { model: from, reasoning_details: details, ...rest } = message;
      out.push(details?.length && from === model ? { ...rest, reasoning_details: details } : rest);
    } else {
      out.push({ ...message });
    }
  });
  return out;
}

function toolDefinitions(tools: Iterable<AgentTool>): Obj[] {
  const defs: Obj[] = [];
  let ownSearch = false;
  for (const tool of tools) {
    if (tool.name === WEB_SEARCH_TOOL) ownSearch = true;
    defs.push({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } });
  }
  if (!ownSearch) defs.push(WEB_SEARCH_DEFINITION);
  return defs;
}

/** Network trouble, rate limits, server errors and broken streams pass;
 *  sign-in, key, credit and request errors do not. */
function transient(error: unknown): boolean {
  if (error instanceof StreamError) return true;
  if (error instanceof TransportError) return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
    const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, ms);
    const stop = () => { clearTimeout(timer); reject(new DOMException("aborted", "AbortError")); };
    signal.addEventListener("abort", stop, { once: true });
  });
}

function effortFor(effort: AgentEffort): AgentEffort {
  if (OPENROUTER_EFFORTS.includes(effort)) return effort;
  return effort === "xhigh" ? "high" : "minimal";
}

class OpenRouterThread implements AgentThread {
  private controller: AbortController | null = null;
  private closed = false;
  private readonly toolDefs: Obj[];

  constructor(
    readonly id: string,
    private readonly provider: OpenRouterProvider,
    private readonly instructions: string,
    private readonly tools: Map<string, AgentTool>,
    private readonly messages: WireMessage[],
    private readonly createdAt: number,
    private readonly ephemeral: boolean,
  ) {
    this.toolDefs = toolDefinitions(tools.values());
  }

  async run(input: string, options: TurnOptions, onEvent: (event: AgentEvent) => void): Promise<TurnResult> {
    if (this.closed) return { status: "failed", error: "thread closed" };
    if (this.controller) return { status: "failed", error: "a turn is already running" };
    const controller = new AbortController();
    this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), TURN_TIMEOUT_MS);
    // Item ids stay unique across turns and resumed chats.
    const turn = crypto.randomUUID().slice(0, 8);
    compact(this.messages);
    this.messages.push({ role: "user", content: input });
    const partial = { content: "" };
    // Progress note of the previous step: when the model ends the turn
    // without further text, that note was its answer.
    const note = { last: null as { itemId: string; text: string } | null };
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        partial.content = "";
        const done = await this.step(`${turn}-${step}`, options, onEvent, controller.signal, partial, note);
        if (done) return { status: "completed" };
      }
      return { status: "failed", error: "the agent took too many steps" };
    } catch (error) {
      // What was already said stays in the history, like in Codex.
      if (partial.content) this.messages.push({ role: "assistant", content: partial.content });
      if (controller.signal.aborted) return { status: "interrupted" };
      return { status: "failed", error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = null;
      repair(this.messages);
      await this.persist();
    }
  }

  /** One model step; true when the turn is complete. */
  private async step(
    key: string,
    options: TurnOptions,
    onEvent: (event: AgentEvent) => void,
    signal: AbortSignal,
    partial: { content: string },
    note: { last: { itemId: string; text: string } | null },
  ): Promise<boolean> {
    const messageId = `${key}-msg`;
    const reasoningId = `${key}-rsn`;
    // Chosen per turn: a fact check runs on the check model, the next turn
    // on the chat model again.
    const model = options.model || this.provider.model.id;
    let result: StepResult;
    // Long tool rounds grow the transcript within a turn as well.
    compact(this.messages);
    for (let attempt = 0; ; attempt++) {
      let shown = false;
      try {
        const response = await this.provider.transport.complete({
          model,
          stream: true,
          messages: requestMessages(this.instructions, this.messages, model),
          tools: this.toolDefs,
          tool_choice: "auto",
          reasoning: { effort: effortFor(options.effort) },
        }, signal);
        result = await readStep(response.body!, {
          onContent: (delta) => {
            shown = true;
            partial.content += delta;
            onEvent({ type: "message-delta", itemId: messageId, delta });
          },
          onReasoning: (delta) => {
            shown = true;
            onEvent({ type: "reasoning-delta", itemId: reasoningId, delta });
          },
        });
        break;
      } catch (error) {
        if (signal.aborted || shown || attempt >= RETRY_DELAYS_MS.length || !transient(error)) throw error;
        console.warn("[agent] model request failed, retrying", error);
        await wait(RETRY_DELAYS_MS[attempt], signal);
      }
    }
    const previousNote = note.last;
    note.last = null;
    if (result.reasoning) onEvent({ type: "reasoning", itemId: reasoningId, text: result.reasoning });
    partial.content = "";
    this.messages.push({
      role: "assistant",
      content: result.content,
      ...(result.toolCalls.length ? { tool_calls: result.toolCalls } : {}),
      ...(result.reasoningDetails.length ? { reasoning_details: result.reasoningDetails, model } : {}),
    });
    if (result.toolCalls.length === 0) {
      if (result.content.trim()) onEvent({ type: "message", itemId: messageId, text: result.content });
      else if (previousNote) onEvent({ type: "message", itemId: previousNote.itemId, text: previousNote.text });
      return true;
    }
    if (result.content.trim()) {
      onEvent({ type: "message", itemId: messageId, text: result.content, commentary: true });
      note.last = { itemId: messageId, text: result.content };
    }
    for (const call of result.toolCalls) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const output = await this.execute(`${key}-${call.id}`, call, model, onEvent, signal);
      this.messages.push({ role: "tool", tool_call_id: call.id, content: output });
    }
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    return false;
  }

  private async execute(itemId: string, call: WireToolCall, model: string, onEvent: (event: AgentEvent) => void, signal: AbortSignal): Promise<string> {
    const name = call.function.name;
    let args: unknown = {};
    let invalid = false;
    try {
      args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
    } catch {
      invalid = true;
    }
    if (name === WEB_SEARCH_TOOL && !this.tools.has(name)) return this.webSearch(itemId, str(obj(args).query).trim(), model, onEvent, signal);
    const tool = this.tools.get(name);
    onEvent({ type: "tool-start", itemId, tool: name, args });
    let result: ToolResult;
    if (!tool) result = { ok: false, output: JSON.stringify({ error: `unknown tool ${name}` }) };
    else if (invalid) result = { ok: false, output: JSON.stringify({ error: "arguments are not valid JSON" }) };
    else {
      try {
        result = await tool.run(args);
      } catch (error) {
        result = { ok: false, output: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) };
      }
    }
    onEvent({ type: "tool-end", itemId, tool: name, args, ok: result.ok });
    return result.output;
  }

  /** The search runs on the model of the turn (a fact check stays light). */
  private async webSearch(itemId: string, query: string, model: string, onEvent: (event: AgentEvent) => void, signal: AbortSignal): Promise<string> {
    if (!query) return JSON.stringify({ error: "query is empty" });
    onEvent({ type: "web-search", itemId, query, status: "running" });
    try {
      const response = await this.provider.transport.complete({
        model,
        stream: false,
        messages: [{ role: "system", content: SEARCH_INSTRUCTIONS }, { role: "user", content: query }],
        plugins: [WEB_SEARCH_PLUGIN],
        reasoning: { effort: "low" },
      }, signal);
      const body = obj(await response.json());
      const message = obj(obj(Array.isArray(body.choices) ? body.choices[0] : null).message);
      const sources: { title: string; url: string }[] = [];
      for (const raw of Array.isArray(message.annotations) ? message.annotations : []) {
        const citation = obj(obj(raw).url_citation);
        const url = str(citation.url);
        if (url && !sources.some((s) => s.url === url)) sources.push({ title: str(citation.title), url });
      }
      return JSON.stringify({ query, findings: str(message.content), sources: sources.slice(0, 8) });
    } catch (error) {
      if (signal.aborted) throw error;
      return JSON.stringify({ error: `web search failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      onEvent({ type: "web-search", itemId, query, status: "done" });
    }
  }

  private async persist(): Promise<void> {
    if (this.ephemeral) return;
    try {
      await this.provider.store.save({
        id: this.id, provider: THREAD_KIND, messagesJson: JSON.stringify(this.messages),
        createdAt: this.createdAt, updatedAt: Date.now(),
      });
      this.provider.saved();
    } catch (error) {
      console.warn("[agent] saving the transcript failed", error);
    }
  }

  async interrupt(): Promise<void> {
    this.controller?.abort();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.controller?.abort();
    this.provider.forget(this);
  }
}

export class OpenRouterProvider implements AgentProvider {
  /** Set by the last check (hosted: the server's model). */
  model: TransportModel = { id: OPENROUTER_MODEL, label: OPENROUTER_MODEL_LABEL };
  /** Model for fact checks, set by the last check; null = the chat model. */
  checkModelInfo: TransportModel | null = null;
  private readonly threads = new Set<OpenRouterThread>();
  private saves = 0;
  /** Set by dispose(): nothing that was under way may send afterwards. */
  private disposed = false;

  constructor(
    readonly id: string,
    readonly transport: OpenRouterTransport,
    readonly store: ThreadStoreLike,
  ) {}

  async check(): Promise<ProviderState> {
    if (this.disposed) return { state: "error", message: "agent provider disposed" };
    try {
      const result = await this.transport.check();
      if (result.model) this.model = result.model;
      if (result.state.state === "ready") this.checkModelInfo = result.checkModel;
      return result.state;
    } catch (error) {
      return { state: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** The checked model as the recommended default; with an own key also
   *  every other model of the catalog, the default first, then by name. A
   *  catalog that does not load leaves the default alone. */
  async listModels(): Promise<AgentModel[]> {
    const fallback = this.model;
    let catalog: TransportModel[] = [];
    if (this.transport.models) {
      catalog = await this.transport.models().catch((error: unknown) => {
        console.warn("[agent] loading the OpenRouter models failed", error);
        return [];
      });
    }
    const recommended = catalog.find((m) => m.id === fallback.id) ?? fallback;
    const others = catalog
      .filter((m) => m.id !== recommended.id)
      .sort((a, b) => localeCompare(a.label, b.label));
    return [recommended, ...others].map((m) => ({
      id: m.id,
      label: m.label,
      description: "",
      efforts: [...OPENROUTER_EFFORTS],
      defaultEffort: DEFAULT_EFFORT,
      isDefault: m.id === recommended.id,
    }));
  }

  checkModel(): AgentModel | null {
    const info = this.checkModelInfo;
    return info ? { id: info.id, label: info.label, description: "", efforts: [...OPENROUTER_EFFORTS], defaultEffort: DEFAULT_EFFORT, isDefault: false } : null;
  }

  async openThread(options: OpenThreadOptions): Promise<AgentThread> {
    if (this.disposed) throw new Error("agent provider disposed");
    let record: ThreadRecord | null = null;
    if (options.resumeId && !options.ephemeral) {
      record = await this.store.get(options.resumeId).catch((error: unknown) => {
        console.warn("[agent] loading the transcript failed, starting fresh", error);
        return null;
      });
      if (record?.provider !== THREAD_KIND) record = null;
    }
    // Switched off or hidden while the transcript loaded.
    if (this.disposed) throw new Error("agent provider disposed");
    const messages = record ? parseMessages(record.messagesJson) : [];
    repair(messages);
    const thread = new OpenRouterThread(
      record?.id ?? crypto.randomUUID(),
      this,
      options.instructions,
      new Map(options.tools.map((tool) => [tool.name, tool])),
      messages,
      record?.createdAt ?? Date.now(),
      options.ephemeral === true,
    );
    this.threads.add(thread);
    return thread;
  }

  /** Every 50 saved turns, old transcripts are pruned. */
  saved(): void {
    this.saves += 1;
    if (this.saves % 50 === 1) void this.store.prune(THREADS_KEPT).catch(() => {});
  }

  forget(thread: OpenRouterThread): void {
    this.threads.delete(thread);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const thread of [...this.threads]) await thread.close();
    this.threads.clear();
  }
}
