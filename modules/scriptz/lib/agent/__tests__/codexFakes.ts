// Scripted Codex app-server for provider tests (codexProvider.test.ts and the
// provider parity test).

import { expect } from "vitest";
import type { CodexHostLike } from "../codex/provider";

type Frame = Record<string, unknown>;

/** Minimal app-server double: answers requests, plays a scripted turn. */
export function fakeCodex() {
  const sent: Frame[] = [];
  let lineCb: ((line: string) => void) | null = null;
  let toolReply: ((result: Frame) => void) | null = null;
  const emit = (frame: Frame) => queueMicrotask(() => lineCb?.(JSON.stringify(frame)));
  let launchConfig: string[] = [];
  const process = {
    async send(line: string) {
      const msg = JSON.parse(line) as Frame;
      sent.push(msg);
      const id = msg.id as number | undefined;
      const params = (msg.params ?? {}) as Frame;
      if (msg.method === undefined && id === 900) { toolReply?.(msg.result as Frame); return; }
      switch (msg.method) {
        case "initialize": emit({ id, result: { userAgent: "codex/0.160.0" } }); break;
        case "config/read": emit({ id, result: { config: { model: "gpt-6-astra", mcp_servers: { "computer-use": {}, imagestudio: {} } } } }); break;
        case "account/read": emit({ id, result: { account: { type: "chatgpt", email: "a@b.de", planType: "prolite" }, requiresOpenaiAuth: true } }); break;
        case "model/list": emit({ id, result: { data: [
          { model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", isDefault: true, hidden: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }] },
          { model: "gpt-6-astra", displayName: "GPT-6-Astra", isDefault: false, hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }, { reasoningEffort: "ultra" }] },
          { model: "gpt-6-luna", displayName: "GPT-6-Luna", isDefault: false, hidden: false, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }] },
          { model: "secret", hidden: true },
        ], nextCursor: null } }); break;
        case "thread/start": emit({ id, result: { thread: { id: "th1" } } }); break;
        case "turn/start": {
          emit({ id, result: { turn: { id: "tu1", status: "inProgress" } } });
          const base = { threadId: params.threadId, turnId: "tu1" };
          emit({ method: "turn/started", params: { ...base, turn: { id: "tu1" } } });
          emit({ method: "item/started", params: { ...base, item: { type: "agentMessage", id: "c1", phase: "commentary", text: "" } } });
          emit({ method: "item/agentMessage/delta", params: { ...base, itemId: "c1", delta: "Ich lese." } });
          emit({ method: "item/completed", params: { ...base, item: { type: "agentMessage", id: "c1", phase: "commentary", text: "Ich lese." } } });
          emit({ method: "item/started", params: { ...base, item: { type: "dynamicToolCall", id: "t1", tool: "get_current_script", arguments: {} } } });
          emit({ id: 900, method: "item/tool/call", params: { ...base, callId: "x", tool: "get_current_script", arguments: {} } });
          toolReply = (result) => {
            expect(result).toEqual({ success: true, contentItems: [{ type: "inputText", text: "SCRIPT" }] });
            emit({ method: "item/completed", params: { ...base, item: { type: "dynamicToolCall", id: "t1", tool: "get_current_script", arguments: {}, success: true, status: "completed" } } });
            emit({ method: "item/started", params: { ...base, item: { type: "webSearch", id: "w1", query: "", action: null } } });
            emit({ method: "item/completed", params: { ...base, item: { type: "webSearch", id: "w1", query: "ArbZG", action: { type: "search", query: "ArbZG Pause" } } } });
            emit({ method: "item/reasoning/summaryTextDelta", params: { ...base, itemId: "r1", delta: "**Plan**" } });
            emit({ method: "item/completed", params: { ...base, item: { type: "reasoning", id: "r1", summary: ["**Plan**"], content: [] } } });
            emit({ method: "item/agentMessage/delta", params: { ...base, itemId: "m1", delta: "Fer" } });
            emit({ method: "item/agentMessage/delta", params: { ...base, itemId: "m1", delta: "tig" } });
            emit({ method: "item/completed", params: { ...base, item: { type: "agentMessage", id: "m1", phase: "final_answer", text: "Fertig" } } });
            emit({ method: "turn/completed", params: { threadId: params.threadId, turn: { id: "tu1", status: "completed", error: null } } });
          };
          break;
        }
        default: if (id !== undefined) emit({ id, result: {} });
      }
    },
    onLine(cb: (line: string) => void) { lineCb = cb; return () => { lineCb = null; }; },
    onExit() { return () => {}; },
    async stop() {},
  };
  const host: CodexHostLike = {
    async locate() { return { path: "/bin/codex", version: "0.160.0" }; },
    async start(config = []) { launchConfig = config; return process; },
  };
  return { host, sent, config: () => launchConfig };
}
