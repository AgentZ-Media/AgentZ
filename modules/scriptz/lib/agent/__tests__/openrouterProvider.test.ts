// OpenRouter harness against a scripted transport: streaming, tool round
// trips with reasoning details, web search, transcripts, interrupt, errors,
// prompt caching and context compaction.

import { describe, expect, it, vi } from "vitest";
import { compact, OpenRouterProvider, repair, requestMessages, THREAD_KIND, type WireMessage } from "../openrouter/provider";
import { IncompleteResponse, mergeReasoningDetails, readStep, StreamError } from "../openrouter/stream";
import { AGENT_INCOMPLETE, AGENT_RATE_LIMITED, type AgentEvent, type AgentTool } from "../types";
import { fakeTransport, memoryThreads } from "./openrouterFakes";

type Obj = Record<string, unknown>;

const tool = (name: string, output: string, calls: unknown[] = []): AgentTool => ({
  name,
  description: `${name} description`,
  parameters: { type: "object", properties: { id: { type: "string" } } },
  run: async (args) => { calls.push(args); return { ok: true, output }; },
});

describe("openrouter harness", () => {
  it("streams an answer and stores the transcript", async () => {
    const { transport, requests } = fakeTransport([{ reasoning: "**Plan** kurz", content: ["Hal", "lo!"] }]);
    const threads = memoryThreads();
    const provider = new OpenRouterProvider("agentz", transport, threads.store);
    expect(await provider.check()).toEqual({ state: "ready", account: "a@b.de" });
    const [model] = await provider.listModels();
    expect(model).toMatchObject({ id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", isDefault: true });

    const thread = await provider.openThread({ instructions: "PERSONA", tools: [] });
    const events: AgentEvent[] = [];
    const result = await thread.run("Hi", { model: model.id, effort: "medium" }, (e) => events.push(e));
    expect(result).toEqual({ status: "completed" });
    expect(events.filter((e) => e.type === "message-delta").map((e) => (e as { delta: string }).delta)).toEqual(["Hal", "lo!"]);
    expect(events.find((e) => e.type === "reasoning")).toMatchObject({ text: "**Plan** kurz" });
    expect(events.at(-1)).toMatchObject({ type: "message", text: "Hallo!" });

    const body = requests[0];
    expect(body).toMatchObject({ model: "google/gemini-3.8-flash", stream: true, tool_choice: "auto", reasoning: { effort: "medium" } });
    // The instructions are the system prompt, unchanged, with a cache breakpoint.
    expect((body.messages as Obj[])[0]).toEqual({ role: "system", content: [{ type: "text", text: "PERSONA", cache_control: { type: "ephemeral" } }] });
    // Web search is always offered.
    expect((body.tools as Obj[]).map((t) => (t.function as Obj).name)).toEqual(["web_search"]);

    const saved = threads.records.get(thread.id);
    expect(saved?.provider).toBe(THREAD_KIND);
    expect(JSON.parse(saved!.messagesJson)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hallo!", reasoning_details: [{ type: "reasoning.text", text: "**Plan** kurz", index: 0 }] },
    ]);
  });

  it("runs tools locally and sends results and reasoning details back", async () => {
    const calls: unknown[] = [];
    const signature = { type: "reasoning.encrypted", data: "SIG", index: 1 };
    const { transport, requests } = fakeTransport([
      { details: [signature], content: ["Ich lese."], toolCalls: [{ id: "call_1", name: "read_script", args: { id: "s1" } }] },
      { content: ["Fertig"] },
    ]);
    const provider = new OpenRouterProvider("openrouter", transport, memoryThreads().store);
    const thread = await provider.openThread({ instructions: "x", tools: [tool("read_script", "SCRIPT", calls)] });
    const events: AgentEvent[] = [];
    expect(await thread.run("Lies", { model: "", effort: "high" }, (e) => events.push(e))).toEqual({ status: "completed" });

    expect(calls).toEqual([{ id: "s1" }]);
    // Text next to tool calls is a progress note, like Codex' commentary.
    expect(events.find((e) => e.type === "message" && e.text === "Ich lese.")).toMatchObject({ commentary: true });
    expect(events.filter((e) => e.type.startsWith("tool-")).map((e) => `${e.type}:${(e as { tool: string }).tool}`)).toEqual(["tool-start:read_script", "tool-end:read_script"]);
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({ ok: true, args: { id: "s1" } });

    const second = requests[1].messages as Obj[];
    expect(second.slice(1, 3)).toEqual([
      { role: "user", content: "Lies" },
      {
        role: "assistant",
        content: "Ich lese.",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "read_script", arguments: "{\"id\":\"s1\"}" } }],
        reasoning_details: [signature],
      },
    ]);
    // The newest message carries the cache breakpoint.
    expect(second[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "SCRIPT", cache_control: { type: "ephemeral" } }] });
  });

  it("answers web_search with the web plugin and real sources", async () => {
    const { transport, requests } = fakeTransport([
      { toolCalls: [{ id: "call_s", name: "web_search", args: { query: "Mindestlohn 2026" } }] },
      { json: { choices: [{ message: { content: "- 13,90 € (bundesregierung.de)", annotations: [
        { type: "url_citation", url_citation: { url: "https://www.bundesregierung.de/a", title: "Mindestlohn" } },
        { type: "url_citation", url_citation: { url: "https://www.bundesregierung.de/a", title: "Mindestlohn" } },
      ] } }] } },
      { content: ["13,90 €."] },
    ]);
    const provider = new OpenRouterProvider("agentz", transport, memoryThreads().store);
    const thread = await provider.openThread({ instructions: "x", tools: [] });
    const events: AgentEvent[] = [];
    await thread.run("Wie hoch?", { model: "", effort: "low" }, (e) => events.push(e));

    expect(events.filter((e) => e.type === "web-search").map((e) => `${(e as { status: string }).status}:${(e as { query: string }).query}`))
      .toEqual(["running:Mindestlohn 2026", "done:Mindestlohn 2026"]);
    // No tool row for the built-in search, like Codex.
    expect(events.some((e) => e.type === "tool-start")).toBe(false);
    expect(requests[1]).toMatchObject({ stream: false, plugins: [{ id: "web", engine: "exa", max_results: 5 }] });
    const toolMessage = (requests[2].messages as Obj[]).at(-1) as { content: { text: string }[] };
    expect(JSON.parse(toolMessage.content[0].text)).toEqual({
      query: "Mindestlohn 2026",
      findings: "- 13,90 € (bundesregierung.de)",
      sources: [{ title: "Mindestlohn", url: "https://www.bundesregierung.de/a" }],
    });
  });

  it("resumes a stored thread with new instructions; ephemeral threads leave no trace", async () => {
    const threads = memoryThreads();
    const first = fakeTransport([{ content: ["Eins"] }]);
    const provider = new OpenRouterProvider("agentz", first.transport, threads.store);
    const thread = await provider.openThread({ instructions: "OLD", tools: [] });
    await thread.run("A", { model: "", effort: "medium" }, () => {});

    const second = fakeTransport([{ content: ["Zwei"] }]);
    const resumed = await new OpenRouterProvider("openrouter", second.transport, threads.store).openThread({ instructions: "NEW", tools: [], resumeId: thread.id });
    expect(resumed.id).toBe(thread.id);
    await resumed.run("B", { model: "", effort: "medium" }, () => {});
    const messages = second.requests[0].messages as Obj[];
    expect((messages[0].content as Obj[])[0]).toMatchObject({ text: "NEW" });
    expect(messages.slice(1, 3)).toEqual([{ role: "user", content: "A" }, { role: "assistant", content: "Eins" }]);

    // An unknown id (e.g. a Codex thread) starts fresh.
    const fresh = await provider.openThread({ instructions: "x", tools: [], resumeId: "codex-thread" });
    expect(fresh.id).not.toBe("codex-thread");

    const before = threads.records.size;
    const learn = await new OpenRouterProvider("agentz", fakeTransport([{ content: ["Nichts Neues."] }]).transport, threads.store)
      .openThread({ instructions: "learn", tools: [], ephemeral: true });
    await learn.run("Lerne", { model: "", effort: "medium" }, () => {});
    expect(threads.records.size).toBe(before);
  });

  it("interrupts a running turn and keeps the transcript valid", async () => {
    const { transport } = fakeTransport([
      { toolCalls: [{ id: "call_1", name: "slow", args: {} }] },
    ]);
    const threads = memoryThreads();
    const provider = new OpenRouterProvider("agentz", transport, threads.store);
    let release: () => void = () => {};
    const slow: AgentTool = {
      name: "slow", description: "d", parameters: { type: "object" },
      run: () => new Promise((resolve) => { release = () => resolve({ ok: true, output: "late" }); }),
    };
    const thread = await provider.openThread({ instructions: "x", tools: [slow] });
    const running = thread.run("Los", { model: "", effort: "medium" }, () => {});
    await new Promise((r) => setTimeout(r, 10));
    await thread.interrupt();
    release();
    expect(await running).toEqual({ status: "interrupted" });
    const stored = JSON.parse(threads.records.get(thread.id)!.messagesJson) as Obj[];
    expect(stored.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_1" });
  });

  it("interrupts a hanging stream and keeps what was said", async () => {
    const { transport } = fakeTransport([{ content: ["Ich fange an"], hang: true }]);
    const threads = memoryThreads();
    const thread = await new OpenRouterProvider("agentz", transport, threads.store).openThread({ instructions: "x", tools: [] });
    const running = thread.run("Los", { model: "", effort: "medium" }, () => {});
    await new Promise((r) => setTimeout(r, 10));
    await thread.interrupt();
    expect(await running).toEqual({ status: "interrupted" });
    expect(JSON.parse(threads.records.get(thread.id)!.messagesJson)).toEqual([
      { role: "user", content: "Los" },
      { role: "assistant", content: "Ich fange an" },
    ]);
  });

  it("reports failures with their code and fails unknown or broken tool calls softly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      // Still limited after the retries: the code reaches the chat.
      const limited = await new OpenRouterProvider("agentz", fakeTransport([{ status: 429 }, { status: 429 }, { status: 429 }]).transport, memoryThreads().store)
        .openThread({ instructions: "x", tools: [] });
      const running = limited.run("Hi", { model: "", effort: "medium" }, () => {});
      await vi.runAllTimersAsync();
      expect(await running).toEqual({ status: "failed", error: AGENT_RATE_LIMITED });
    } finally {
      vi.useRealTimers();
    }

    const { transport, requests } = fakeTransport([
      { toolCalls: [{ id: "c1", name: "nope", args: {} }] },
      { content: ["Ok"] },
    ]);
    const events: AgentEvent[] = [];
    const thread = await new OpenRouterProvider("agentz", transport, memoryThreads().store).openThread({ instructions: "x", tools: [] });
    expect(await thread.run("Hi", { model: "", effort: "medium" }, (e) => events.push(e))).toEqual({ status: "completed" });
    expect(events.find((e) => e.type === "tool-end")).toMatchObject({ tool: "nope", ok: false });
    expect(JSON.stringify((requests[1].messages as Obj[]).at(-1))).toContain("unknown tool nope");
  });

  it("retries passing failures before anything was shown, but not sign-in errors", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const flaky = fakeTransport([{ status: 502 }, { status: 429 }, { content: ["Da."] }]);
      const thread = await new OpenRouterProvider("agentz", flaky.transport, memoryThreads().store).openThread({ instructions: "x", tools: [] });
      const running = thread.run("Hi", { model: "", effort: "medium" }, () => {});
      await vi.runAllTimersAsync();
      expect(await running).toEqual({ status: "completed" });
      expect(flaky.requests).toHaveLength(3);

      const denied = fakeTransport([{ status: 401 }, { content: ["nie"] }]);
      const other = await new OpenRouterProvider("agentz", denied.transport, memoryThreads().store).openThread({ instructions: "x", tools: [] });
      const result = other.run("Hi", { model: "", effort: "medium" }, () => {});
      await vi.runAllTimersAsync();
      expect((await result).status).toBe("failed");
      expect(denied.requests).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns the last note into the answer when the turn ends without text", async () => {
    const { transport } = fakeTransport([
      { content: [":::draft id=\"a\" title=\"A\"\nTIMO: Hi\n:::"], toolCalls: [{ id: "c1", name: "suggest_replies", args: { replies: ["Kürzer"] } }] },
      { content: [] },
    ]);
    const events: AgentEvent[] = [];
    const thread = await new OpenRouterProvider("agentz", transport, memoryThreads().store)
      .openThread({ instructions: "x", tools: [tool("suggest_replies", "{}")] });
    await thread.run("Schreib", { model: "", effort: "medium" }, (e) => events.push(e));
    const messages = events.filter((e) => e.type === "message") as Extract<AgentEvent, { type: "message" }>[];
    expect(messages.map((m) => m.commentary === true)).toEqual([true, false]);
    expect(messages[1].itemId).toBe(messages[0].itemId);
  });

  it("maps efforts onto what OpenRouter offers", async () => {
    const { transport, requests } = fakeTransport([{ content: ["a"] }, { content: ["b"] }]);
    const thread = await new OpenRouterProvider("agentz", transport, memoryThreads().store).openThread({ instructions: "x", tools: [] });
    await thread.run("1", { model: "", effort: "xhigh" }, () => {});
    await thread.run("2", { model: "", effort: "none" }, () => {});
    expect(requests.map((r) => (r.reasoning as Obj).effort)).toEqual(["high", "minimal"]);
  });
});

describe("harness transcript helpers", () => {
  it("answers dangling tool calls", () => {
    const messages: WireMessage[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "", tool_calls: [
        { id: "1", type: "function", function: { name: "x", arguments: "{}" } },
        { id: "2", type: "function", function: { name: "y", arguments: "{}" } },
      ] },
      { role: "tool", tool_call_id: "1", content: "ok" },
      { role: "user", content: "b" },
    ];
    repair(messages);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "user"]);
    expect(messages[3]).toMatchObject({ tool_call_id: "2" });
  });

  it("drops old tool output first, then the oldest turns", () => {
    const big = "x".repeat(1000);
    const messages: WireMessage[] = [];
    for (let i = 0; i < 40; i++) {
      messages.push({ role: "user", content: `q${i}` });
      messages.push({ role: "tool", tool_call_id: `t${i}`, content: big });
    }
    compact(messages, 30_000);
    expect(messages.at(-1)?.content).toBe(big);
    expect(messages[1].content).toContain("omitted");
    compact(messages, 10_000);
    expect(messages[0].role).toBe("user");
    expect(messages.length).toBeLessThan(80);
  });

  it("puts cache breakpoints on the instructions and the newest message only", () => {
    const out = requestMessages("SYS", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }]);
    expect(out.map((m) => typeof m.content === "string" ? m.content : "cached")).toEqual(["cached", "a", "b", "cached"]);
  });

  it("merges streamed reasoning pieces by type and index", () => {
    const into: Obj[] = [];
    mergeReasoningDetails(into, [{ type: "reasoning.text", text: "Hal", index: 0 }]);
    mergeReasoningDetails(into, [{ type: "reasoning.text", text: "lo", index: 0, signature: "s" }, { type: "reasoning.encrypted", data: "E", index: 1 }]);
    expect(into).toEqual([{ type: "reasoning.text", text: "Hallo", index: 0, signature: "s" }, { type: "reasoning.encrypted", data: "E", index: 1 }]);
  });
});

describe("openrouter stream end", () => {
  const body = (...chunks: Obj[]) => {
    const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });
  };
  const handlers = { onContent: () => {}, onReasoning: () => {} };
  const piece = (delta: Obj, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

  it("accepts a finished answer", async () => {
    const step = await readStep(body(piece({ content: "Hi" }), piece({}, "stop")), handlers);
    expect(step).toMatchObject({ content: "Hi", finishReason: "stop" });
  });

  it("treats a stream without a finish reason as broken off (retried)", async () => {
    await expect(readStep(body(piece({ content: "Hi" })), handlers)).rejects.toBeInstanceOf(StreamError);
  });

  it("treats cut or filtered answers as incomplete, tool calls included", async () => {
    for (const reason of ["length", "content_filter"]) {
      const call = { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "remember", arguments: "{\"te" } }] };
      const failure = readStep(body(piece(call), piece({}, reason)), handlers);
      await expect(failure).rejects.toBeInstanceOf(IncompleteResponse);
      await expect(failure).rejects.toThrow(AGENT_INCOMPLETE);
    }
  });
});

describe("disposed providers", () => {
  it("open no thread and send nothing after dispose, also when it lands mid-load", async () => {
    const { transport, requests } = fakeTransport([{ content: ["Hallo"] }]);
    const threads = memoryThreads();
    let release: () => void = () => {};
    const store = { ...threads.store, get: (id: string) => new Promise<null>((resolve) => { release = () => resolve(null); void id; }) };
    const provider = new OpenRouterProvider("openrouter", transport, store);
    const opening = provider.openThread({ instructions: "PERSONA", tools: [], resumeId: "old" });
    await provider.dispose();
    release();
    await expect(opening).rejects.toThrow("disposed");
    await expect(provider.openThread({ instructions: "PERSONA", tools: [] })).rejects.toThrow("disposed");
    expect(await provider.check()).toMatchObject({ state: "error" });
    expect(requests).toHaveLength(0);
  });
});
