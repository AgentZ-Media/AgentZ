import { afterEach, describe, expect, it } from "vitest";
import { agentUi, startAgentUiRuntime } from "../agentUi";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

describe("agent chat visibility", () => {
  it("starts closed in every script", () => {
    stop = startAgentUiRuntime();
    expect(agentUi.chatOpen("a")).toBe(false);
    expect(agentUi.chatOpen("b")).toBe(false);
  });

  it("remembers the chat per script for the session", () => {
    stop = startAgentUiRuntime();
    agentUi.toggleChat("a");
    expect(agentUi.chatOpen("a")).toBe(true);
    expect(agentUi.chatOpen("b")).toBe(false);
    agentUi.ask({ scriptId: "b", text: "", send: false });
    expect(agentUi.chatOpen("b")).toBe(true);
    agentUi.setChatOpen("a", false);
    expect(agentUi.chatOpen("a")).toBe(false);
  });

  it("closes every chat on a fresh start", () => {
    stop = startAgentUiRuntime();
    agentUi.setChatOpen("a", true);
    stop();
    stop = startAgentUiRuntime();
    expect(agentUi.chatOpen("a")).toBe(false);
  });
});
