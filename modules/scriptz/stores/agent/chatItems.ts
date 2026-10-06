import { produce, type SetStoreFunction } from "solid-js/store";
import type { ChatItem } from "../../lib/agent/chats";
import { deleteMemory, restoreMemory, updateMemory } from "../../lib/agent/memory";
import type { MemoryChange } from "../../lib/agent/tools";
import type { AgentEvent } from "../../lib/agent/types";

// ---------------------------------------------------------------------------
// Chat items: local ids, memory notices and the provider event reducer
// ---------------------------------------------------------------------------

let nextLocalId = 1;
export const localId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${nextLocalId++}`;

export function memoryItem(change: MemoryChange): ChatItem {
  return change.action === "updated"
    ? { kind: "memory", id: localId("mem"), action: "updated", entry: change.entry, previous: change.previous }
    : { kind: "memory", id: localId("mem"), action: change.action, entry: change.entry };
}

export async function undoMemoryChange(item: Extract<ChatItem, { kind: "memory" }>): Promise<void> {
  if (item.action === "added") await deleteMemory(item.entry.id);
  else if (item.action === "removed") await restoreMemory(item.entry);
  else if (item.previous) await updateMemory(item.previous.id, item.previous.content).catch(() => restoreMemory(item.previous!));
}

/** Maps one provider event onto the chat items (streaming in place). */
export function applyEvent(setState: SetStoreFunction<{ items: ChatItem[] }>, event: AgentEvent): void {
  applyEvents(setState, [event]);
}

/** Maps provider events onto the chat items in one store update. */
export function applyEvents(setState: SetStoreFunction<{ items: ChatItem[] }>, events: readonly AgentEvent[]): void {
  if (events.length === 0) return;
  setState("items", produce((items) => {
    for (const event of events) reduceEvent(items, event);
  }));
}

/** Index of an item by id, searched from the end: streamed and finished
 *  items are almost always the newest ones. */
function find(items: ChatItem[], id: string): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].id === id) return i;
  return -1;
}

function reduceEvent(items: ChatItem[], event: AgentEvent): void {
  switch (event.type) {
    case "message-delta": {
      const i = find(items, event.itemId);
      if (i >= 0 && items[i].kind === "assistant") (items[i] as Extract<ChatItem, { kind: "assistant" }>).text += event.delta;
      else items.push({ kind: "assistant", id: event.itemId, text: event.delta, streaming: true, commentary: event.commentary });
      return;
    }
    case "message": {
      const i = find(items, event.itemId);
      if (!event.text.trim()) { if (i >= 0) items.splice(i, 1); return; }
      if (i >= 0 && items[i].kind === "assistant") Object.assign(items[i], { text: event.text, streaming: false, commentary: event.commentary });
      else items.push({ kind: "assistant", id: event.itemId, text: event.text, commentary: event.commentary });
      return;
    }
    case "reasoning-delta": {
      const i = find(items, event.itemId);
      if (i >= 0 && items[i].kind === "thinking") (items[i] as Extract<ChatItem, { kind: "thinking" }>).text += event.delta;
      else items.push({ kind: "thinking", id: event.itemId, text: event.delta, done: false });
      return;
    }
    case "reasoning": {
      const i = find(items, event.itemId);
      if (!event.text.trim()) { if (i >= 0) items.splice(i, 1); return; }
      if (i >= 0 && items[i].kind === "thinking") Object.assign(items[i], { text: event.text, done: true });
      else items.push({ kind: "thinking", id: event.itemId, text: event.text, done: true });
      return;
    }
    case "tool-start": {
      if (HIDDEN_TOOLS.has(event.tool)) return;
      if (find(items, event.itemId) >= 0) return;
      items.push({ kind: "tool", id: event.itemId, tool: event.tool, args: argsOf(event.args), status: "running" });
      return;
    }
    case "tool-end": {
      if (HIDDEN_TOOLS.has(event.tool)) return;
      const i = find(items, event.itemId);
      const status = event.ok ? "done" as const : "failed" as const;
      if (i >= 0 && items[i].kind === "tool") Object.assign(items[i], { status, args: argsOf(event.args) });
      else items.push({ kind: "tool", id: event.itemId, tool: event.tool, args: argsOf(event.args), status });
      return;
    }
    case "web-search": {
      const i = find(items, event.itemId);
      const status = event.status === "done" ? "done" as const : "running" as const;
      if (i >= 0 && items[i].kind === "search") Object.assign(items[i], { status, query: event.query || (items[i] as Extract<ChatItem, { kind: "search" }>).query });
      else items.push({ kind: "search", id: event.itemId, query: event.query, status });
      return;
    }
    case "blocked":
      items.push({ kind: "blocked", id: event.itemId, what: event.what });
      return;
    case "error":
      items.push({ kind: "error", id: `err-${items.length}`, message: event.message });
      return;
  }
}

/** Without frames (hidden window) buffered text still goes out this soon. */
const STREAM_FALLBACK_MS = 100;
/** Frame length where `requestAnimationFrame` is missing (tests). */
const FRAME_MS = 16;

export interface EventBuffer {
  push(event: AgentEvent): void;
  /** Applies what is buffered now (turn end, before other items). */
  flush(): void;
}

/** Streamed deltas of one turn, applied once per animation frame instead of
 *  once per token. Deltas of the same item are merged; any other event
 *  first applies what is buffered, so the order of items stays exact. */
export function createEventBuffer(apply: (events: AgentEvent[]) => void): EventBuffer {
  let pending: AgentEvent[] = [];
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    frame = null;
    timer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    apply(batch);
  };
  const schedule = () => {
    if (frame !== null || timer !== null) return;
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(flush);
      timer = setTimeout(flush, STREAM_FALLBACK_MS);
    } else {
      timer = setTimeout(flush, FRAME_MS);
    }
  };
  return {
    push(event) {
      if (event.type !== "message-delta" && event.type !== "reasoning-delta") {
        pending.push(event);
        flush();
        return;
      }
      const last = pending[pending.length - 1];
      // The first delta of an item creates it (with its commentary flag);
      // later ones only add text, so merging keeps the result the same.
      if (last && (last.type === "message-delta" || last.type === "reasoning-delta") && last.type === event.type && last.itemId === event.itemId) {
        pending[pending.length - 1] = { ...last, delta: last.delta + event.delta };
      } else {
        pending.push(event);
      }
      schedule();
    },
    flush,
  };
}

/** Tools whose result is shown as its own card (or not at all). */
const HIDDEN_TOOLS = new Set(["propose_options", "report_fact_check", "remember", "update_memory", "forget_memory", "propose_ideas", "save_ideas", "suggest_replies"]);

function argsOf(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try { return argsOf(JSON.parse(raw)); } catch { return {}; }
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function finishStreaming(setState: SetStoreFunction<{ items: ChatItem[] }>): void {
  setState("items", produce((items) => {
    for (const item of items) {
      if (item.kind === "assistant" && item.streaming) item.streaming = false;
      if (item.kind === "thinking" && !item.done) item.done = true;
      if ((item.kind === "tool" || item.kind === "search") && item.status === "running") item.status = "done";
    }
  }));
}
