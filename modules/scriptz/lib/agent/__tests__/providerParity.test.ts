// Provider parity: Codex and the OpenRouter harness run exactly the same
// agent. Both get the same instructions and tool definitions unchanged, and
// the same turn (progress note, tool call, web search, reasoning, answer)
// produces the same events for chat, learning and UI. A new provider or a new
// capability belongs in this test.

import { describe, expect, it } from "vitest";
import { CodexProvider } from "../codex/provider";
import { OpenRouterProvider } from "../openrouter/provider";
import type { AgentEvent, AgentProvider, AgentTool } from "../types";
import { fakeCodex } from "./codexFakes";
import { fakeTransport, memoryThreads } from "./openrouterFakes";

type Obj = Record<string, unknown>;

const INSTRUCTIONS = "You are Ida.\n\n---\n\nRULES\n\n---\n\nYour memory:\nnothing";
const TOOLS = (): AgentTool[] => [{
  name: "get_current_script",
  description: "Read the open script as numbered lines.",
  parameters: { type: "object", properties: { from: { type: "integer", description: "First line" } }, additionalProperties: false },
  run: async () => ({ ok: true, output: "SCRIPT" }),
}];

/** What chat and UI keep of a turn (deltas and running states only animate it). */
function settled(events: AgentEvent[]): string[] {
  return events.flatMap((e) => {
    switch (e.type) {
      case "message": return [`message${e.commentary ? "(note)" : ""}: ${e.text}`];
      case "reasoning": return [`reasoning: ${e.text}`];
      case "tool-start": return [`tool-start: ${e.tool}`];
      case "tool-end": return [`tool-end: ${e.tool} ${e.ok ? "ok" : "failed"}`];
      case "web-search": return e.status === "done" ? [`web-search: ${e.query}`] : [];
      case "blocked": return [`blocked: ${e.what}`];
      case "error": return [`error: ${e.message}`];
      default: return [];
    }
  });
}

async function runTurn(provider: AgentProvider): Promise<string[]> {
  const thread = await provider.openThread({ instructions: INSTRUCTIONS, tools: TOOLS() });
  const events: AgentEvent[] = [];
  const result = await thread.run("Prüf die Fakten", { model: "", effort: "medium" }, (e) => events.push(e));
  expect(result).toEqual({ status: "completed" });
  return settled(events);
}

describe("provider parity", () => {
  it("Codex and OpenRouter get the same instructions and tools and emit the same turn", async () => {
    const codex = fakeCodex();
    const codexEvents = await runTurn(new CodexProvider(codex.host));

    const openrouter = fakeTransport([
      { content: ["Ich lese."], toolCalls: [{ id: "c1", name: "get_current_script", args: {} }] },
      { toolCalls: [{ id: "c2", name: "web_search", args: { query: "ArbZG Pause" } }] },
      { json: { choices: [{ message: { content: "30 Minuten ab sechs Stunden.", annotations: [] } }] } },
      { reasoning: "**Plan**", content: ["Fer", "tig"] },
    ]);
    const openrouterEvents = await runTurn(new OpenRouterProvider("agentz", openrouter.transport, memoryThreads().store));

    expect(openrouterEvents).toEqual(codexEvents);
    expect(codexEvents).toEqual([
      "message(note): Ich lese.",
      "tool-start: get_current_script",
      "tool-end: get_current_script ok",
      "web-search: ArbZG Pause",
      "reasoning: **Plan**",
      "message: Fertig",
    ]);

    // Same instructions, word for word.
    const start = codex.sent.find((f) => f.method === "thread/start")?.params as Obj;
    const system = (openrouter.requests[0].messages as Obj[])[0].content as Obj[];
    expect(start.developerInstructions).toBe(INSTRUCTIONS);
    expect(system[0].text).toBe(INSTRUCTIONS);

    // Same tools: name, description and schema unchanged; OpenRouter adds
    // only web search, which Codex has built in.
    const codexTools = (start.dynamicTools as Obj[]).map((t) => ({ name: t.name, description: t.description, schema: t.inputSchema }));
    const openrouterTools = (openrouter.requests[0].tools as Obj[])
      .map((t) => t.function as Obj)
      .filter((f) => f.name !== "web_search")
      .map((f) => ({ name: f.name, description: f.description, schema: f.parameters }));
    expect(openrouterTools).toEqual(codexTools);
  });

  it("both list models with efforts and a default", async () => {
    const codex = new CodexProvider(fakeCodex().host);
    await codex.check();
    const openrouter = new OpenRouterProvider("agentz", fakeTransport([]).transport, memoryThreads().store);
    await openrouter.check();
    for (const list of [await codex.listModels(), await openrouter.listModels()]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.filter((m) => m.isDefault)).toHaveLength(1);
      for (const model of list) {
        expect(model.efforts.length).toBeGreaterThan(0);
        expect(model.efforts).toContain("medium");
      }
    }
  });

  it("both name a lighter model for fact checks, apart from the chat default", async () => {
    const codex = new CodexProvider(fakeCodex().host);
    await codex.check();
    const openrouter = new OpenRouterProvider("agentz", fakeTransport([]).transport, memoryThreads().store);
    await openrouter.check();
    const codexModels = await codex.listModels();
    const openrouterModels = await openrouter.listModels();
    expect(codex.checkModel(codexModels)?.id).toBe("gpt-6-luna");
    expect(openrouter.checkModel()?.id).toBe("openai/gpt-6-luna");
    for (const [provider, list] of [[codex, codexModels], [openrouter, openrouterModels]] as const) {
      const check = provider.checkModel(list);
      expect(check?.efforts).toContain("medium");
      expect(check?.id).not.toBe(list.find((m) => m.isDefault)?.id);
    }
    // Without one the checks fall back to the chat model.
    expect(codex.checkModel([])).toBeNull();
  });
});
