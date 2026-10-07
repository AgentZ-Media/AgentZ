// Codex provider against a scripted fake app-server: handshake, config
// isolation, model list, dynamic tool round trip and event mapping.

import { describe, expect, it } from "vitest";
import { CodexProvider, type CodexHostLike } from "../codex/provider";
import { fakeCodex } from "./codexFakes";
import { AGENT_PROCESS_EXITED, type AgentEvent } from "../types";

type Frame = Record<string, unknown>;

describe("codex provider", () => {
  it("connects, isolates the user's config and maps a full turn", async () => {
    const fake = fakeCodex();
    const provider = new CodexProvider(fake.host);

    expect(await provider.check()).toEqual({ state: "ready", account: "a@b.de · Pro Lite" });
    expect(fake.config()).toContain('web_search="live"');
    expect(fake.config()).toContain("features.shell_tool=false");
    expect(fake.config()).not.toContain("features.code_mode_host=false");

    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6-astra"]);
    // The model the user runs Codex with becomes the default.
    expect(models.find((m) => m.isDefault)?.id).toBe("gpt-6-astra");
    expect(models[1].efforts).toEqual(["medium", "high"]);

    const thread = await provider.openThread({
      instructions: "persona",
      tools: [{ name: "get_current_script", description: "d", parameters: { type: "object" }, run: async () => ({ ok: true, output: "SCRIPT" }) }],
    });
    const start = fake.sent.find((f) => f.method === "thread/start")?.params as Frame;
    expect(start.environments).toEqual([]);
    expect(start.sandbox).toBe("read-only");
    expect(start.config).toEqual({ "mcp_servers.computer-use.enabled": false, "mcp_servers.imagestudio.enabled": false });
    expect((start.dynamicTools as Frame[])[0]).toMatchObject({ type: "function", name: "get_current_script" });

    const events: AgentEvent[] = [];
    const result = await thread.run("Hallo", { model: "gpt-6-astra", effort: "medium" }, (e) => events.push(e));
    expect(result).toEqual({ status: "completed" });
    const turn = fake.sent.find((f) => f.method === "turn/start")?.params as Frame;
    expect(turn).toMatchObject({ model: "gpt-6-astra", effort: "medium", summary: "detailed" });

    expect(events.find((e) => e.type === "message" && e.itemId === "c1")).toMatchObject({ commentary: true });
    expect(events.filter((e) => e.type === "tool-start" || e.type === "tool-end").map((e) => e.type)).toEqual(["tool-start", "tool-end"]);
    expect(events.find((e) => e.type === "web-search" && e.status === "done")).toMatchObject({ query: "ArbZG Pause" });
    expect(events.find((e) => e.type === "reasoning")).toMatchObject({ text: "**Plan**" });
    expect(events.at(-1)).toMatchObject({ type: "message", text: "Fertig", commentary: false });
  });

  it("ends a running turn at once when the app-server exits", async () => {
    let exit: ((code: number | null) => void) | null = null;
    let lineCb: ((line: string) => void) | null = null;
    let starts = 0;
    const reply = (frame: Frame) => queueMicrotask(() => lineCb?.(JSON.stringify(frame)));
    const host: CodexHostLike = {
      async locate() { return { path: "/bin/codex", version: "0.160.0" }; },
      async start() {
        starts += 1;
        return {
          async send(line: string) {
            const msg = JSON.parse(line) as Frame;
            if (msg.id === undefined) return;
            if (msg.method === "thread/start") reply({ id: msg.id, result: { thread: { id: "th1" } } });
            else if (msg.method === "turn/start") {
              reply({ id: msg.id, result: { turn: { id: "tu1" } } });
              // Acknowledged, then the process dies before turn/completed.
              setTimeout(() => exit?.(1), 5);
            } else reply({ id: msg.id, result: {} });
          },
          onLine(cb: (line: string) => void) { lineCb = cb; return () => { lineCb = null; }; },
          onExit(cb: (code: number | null) => void) { exit = cb; return () => { exit = null; }; },
          async stop() {},
        };
      },
    };
    const provider = new CodexProvider(host);
    const thread = await provider.openThread({ instructions: "x", tools: [] });
    const result = await thread.run("Hallo", { model: "m", effort: "medium" }, () => {});
    expect(result).toEqual({ status: "failed", error: AGENT_PROCESS_EXITED });
    // The dead thread refuses work; a new thread starts a new process.
    expect((await thread.run("x", { model: "m", effort: "medium" }, () => {})).status).toBe("failed");
    await provider.openThread({ instructions: "x", tools: [] });
    expect(starts).toBe(2);
  });
});
