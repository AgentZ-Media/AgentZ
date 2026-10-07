// Test doubles for the OpenRouter harness: a transport that answers each
// request with the next scripted step as a server-sent event stream, and an
// in-memory transcript store.

import type { ThreadStoreLike } from "../openrouter/provider";
import { TransportError, type OpenRouterTransport, type TransportCheck } from "../openrouter/transport";
import type { ThreadRecord } from "../storage";
import { AGENT_RATE_LIMITED } from "../types";

type Obj = Record<string, unknown>;

export interface ScriptedStep {
  reasoning?: string;
  /** Opaque details the model needs back (Gemini thought signature). */
  details?: Obj[];
  content?: string[];
  toolCalls?: { id: string; name: string; args: unknown }[];
  /** Answer of a non-streamed request (web search). */
  json?: Obj;
  /** Fail the request with this HTTP status instead. */
  status?: number;
  /** Never finish: the stream stays open until aborted. */
  hang?: boolean;
}

const encoder = new TextEncoder();

function chunk(delta: Obj, finish: string | null = null): string {
  return `data: ${JSON.stringify({ id: "gen", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

export function sseStream(step: ScriptedStep, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const parts: string[] = [": OPENROUTER PROCESSING\n\n"];
  if (step.reasoning) {
    // Split in two to exercise merging of streamed pieces.
    const half = Math.ceil(step.reasoning.length / 2);
    parts.push(chunk({ reasoning: step.reasoning.slice(0, half), reasoning_details: [{ type: "reasoning.text", text: step.reasoning.slice(0, half), index: 0 }] }));
    parts.push(chunk({ reasoning: step.reasoning.slice(half), reasoning_details: [{ type: "reasoning.text", text: step.reasoning.slice(half), index: 0 }] }));
  }
  if (step.details) parts.push(chunk({ reasoning_details: step.details }));
  for (const text of step.content ?? []) parts.push(chunk({ content: text }));
  (step.toolCalls ?? []).forEach((call, index) => {
    const args = JSON.stringify(call.args);
    parts.push(chunk({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.name, arguments: "" } }] }));
    parts.push(chunk({ tool_calls: [{ index, function: { arguments: args.slice(0, 3) } }] }));
    parts.push(chunk({ tool_calls: [{ index, function: { arguments: args.slice(3) } }] }));
  });
  if (!step.hang) {
    parts.push(chunk({}, step.toolCalls?.length ? "tool_calls" : "stop"));
    parts.push("data: [DONE]\n\n");
  }
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      if (!step.hang) controller.close();
      else signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    },
  });
}

export function fakeTransport(steps: ScriptedStep[], check?: TransportCheck) {
  const requests: Obj[] = [];
  const transport: OpenRouterTransport = {
    async check() {
      return check ?? { state: { state: "ready", account: "a@b.de" }, model: { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash" } };
    },
    async complete(body, signal) {
      // A deep copy, as it went over the wire.
      requests.push(JSON.parse(JSON.stringify(body)) as Obj);
      const step = steps.shift();
      if (!step) throw new Error("no scripted step left");
      if (step.status) throw new TransportError(step.status === 429 ? AGENT_RATE_LIMITED : `failed ${step.status}`, step.status);
      if (step.json) return new Response(JSON.stringify(step.json), { headers: { "Content-Type": "application/json" } });
      return new Response(sseStream(step, signal), { headers: { "Content-Type": "text/event-stream" } });
    },
  };
  return { transport, requests, steps };
}

export function memoryThreads() {
  const records = new Map<string, ThreadRecord>();
  const store: ThreadStoreLike = {
    async get(id) { return records.get(id) ?? null; },
    async save(record) { records.set(record.id, { ...record }); },
    async prune() {},
  };
  return { store, records };
}
