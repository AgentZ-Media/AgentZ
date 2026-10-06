import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "solid-js/store";
import type { ChatItem } from "../../../lib/agent/chats";
import type { AgentEvent } from "../../../lib/agent/types";
import { applyEvents, createEventBuffer } from "../chatItems";

afterEach(() => vi.useRealTimers());

describe("streamed chat events", () => {
  it("applies deltas once per frame, merged, and keeps the order of other events", () => {
    vi.useFakeTimers();
    const [state, setState] = createStore<{ items: ChatItem[] }>({ items: [] });
    const batches: AgentEvent[][] = [];
    const buffer = createEventBuffer((events) => {
      batches.push(events);
      applyEvents(setState, events);
    });
    buffer.push({ type: "reasoning-delta", itemId: "r", delta: "Hm" });
    buffer.push({ type: "reasoning-delta", itemId: "r", delta: "m." });
    buffer.push({ type: "message-delta", itemId: "m", delta: "Hal" });
    buffer.push({ type: "message-delta", itemId: "m", delta: "lo" });
    expect(state.items).toEqual([]);
    vi.advanceTimersByTime(120);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
    expect(state.items.map((item) => ("text" in item ? item.text : ""))).toEqual(["Hmm.", "Hallo"]);

    // Another event first applies what is buffered, then itself.
    buffer.push({ type: "message-delta", itemId: "m", delta: " Welt" });
    buffer.push({ type: "tool-start", itemId: "t", tool: "read_script", args: {} });
    expect(state.items.map((item) => item.id)).toEqual(["r", "m", "t"]);
    expect((state.items[1] as Extract<ChatItem, { kind: "assistant" }>).text).toBe("Hallo Welt");

    // Turn end: flushed at once, nothing left for the timer.
    buffer.push({ type: "message-delta", itemId: "m", delta: "!" });
    buffer.flush();
    expect((state.items[1] as Extract<ChatItem, { kind: "assistant" }>).text).toBe("Hallo Welt!");
    const count = batches.length;
    vi.advanceTimersByTime(200);
    expect(batches).toHaveLength(count);
  });
});
