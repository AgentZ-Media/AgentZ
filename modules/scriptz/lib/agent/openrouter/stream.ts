// Reads one streamed chat completion (OpenAI-style server-sent events, as
// OpenRouter and the hosted proxy send them) into one model step: text,
// reasoning, the opaque reasoning details the model needs back on the next
// request (Gemini thought signatures) and the tool calls.

import { obj, type Obj } from "../toolArgs";

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StepResult {
  content: string;
  reasoning: string;
  /** Passed back unchanged with the assistant message. */
  reasoningDetails: Obj[];
  toolCalls: WireToolCall[];
  finishReason: string | null;
}

export interface StepHandlers {
  onContent(delta: string): void;
  onReasoning(delta: string): void;
}

/** An error the stream reported itself (after a 200 response). */
export class StreamError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Payloads of `data:` lines; comments (": OPENROUTER PROCESSING") and
 *  blank lines are skipped. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith("data:")) yield buffer.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

/** Streamed reasoning details arrive in pieces; pieces with the same type and
 *  index belong together (text concatenated, other fields kept). */
export function mergeReasoningDetails(into: Obj[], pieces: unknown): void {
  if (!Array.isArray(pieces)) return;
  for (const raw of pieces) {
    const piece = obj(raw);
    if (!Object.keys(piece).length) continue;
    const index = typeof piece.index === "number" ? piece.index : null;
    const same = index === null ? undefined : into.find((d) => d.type === piece.type && d.index === index);
    if (!same) {
      into.push({ ...piece });
      continue;
    }
    for (const [key, value] of Object.entries(piece)) {
      if ((key === "text" || key === "summary") && typeof value === "string") same[key] = str(same[key]) + value;
      else if (value !== null && value !== undefined) same[key] = value;
    }
  }
}

export async function readStep(body: ReadableStream<Uint8Array>, handlers: StepHandlers): Promise<StepResult> {
  const step: StepResult = { content: "", reasoning: "", reasoningDetails: [], toolCalls: [], finishReason: null };
  const calls = new Map<number, WireToolCall>();
  for await (const data of sseData(body)) {
    if (data === "[DONE]") break;
    let chunk: Obj;
    try {
      chunk = obj(JSON.parse(data));
    } catch {
      continue;
    }
    const error = obj(chunk.error);
    if (Object.keys(error).length) {
      throw new StreamError(str(error.message) || "stream error", typeof error.code === "number" ? error.code : null);
    }
    const choice = obj(Array.isArray(chunk.choices) ? chunk.choices[0] : null);
    const delta = obj(choice.delta);
    const reasoning = str(delta.reasoning);
    if (reasoning) {
      step.reasoning += reasoning;
      handlers.onReasoning(reasoning);
    }
    mergeReasoningDetails(step.reasoningDetails, delta.reasoning_details);
    const content = str(delta.content);
    if (content) {
      step.content += content;
      handlers.onContent(content);
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const piece = obj(raw);
        const index = typeof piece.index === "number" ? piece.index : calls.size;
        const fn = obj(piece.function);
        const call = calls.get(index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
        if (str(piece.id)) call.id = str(piece.id);
        if (str(fn.name)) call.function.name += str(fn.name);
        call.function.arguments += str(fn.arguments);
        calls.set(index, call);
      }
    }
    if (typeof choice.finish_reason === "string") step.finishReason = choice.finish_reason;
    if (step.finishReason === "error") throw new StreamError(str(obj(choice.error).message) || "model error", null);
  }
  step.toolCalls = [...calls.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, call]) => ({ ...call, id: call.id || `call_${index}_${Math.random().toString(36).slice(2, 10)}` }))
    .filter((call) => call.function.name);
  return step;
}
