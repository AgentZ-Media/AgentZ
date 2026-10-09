// Checkable claims: the decision model only runs for signed-in accounts with
// AI access while the agent is on; a click fact-checks one line in a
// background thread with the chat's instructions and two tools.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { setKvStore, type KvStore } from "@agentz/kit/platform";
import { claimKey } from "../../../lib/agent/claimScan";
import type { AgentBlock } from "../../../lib/agent/scriptText";
import type { AgentEvent, AgentTool, OpenThreadOptions } from "../../../lib/agent/types";

const [signedIn, setSignedIn] = createSignal(true);
const [access, setAccess] = createSignal(true);
const decide = vi.fn();

vi.mock("@agentz/kit/account", () => {
  class DecisionError extends Error {
    constructor(readonly code: string) { super(code); }
  }
  return { account: { signedIn: () => signedIn() }, decide: (...args: unknown[]) => decide(...args), DecisionError };
});

let opened: OpenThreadOptions[] = [];
let runModels: string[] = [];
let turn: (tools: AgentTool[], onEvent: (event: AgentEvent) => void) => Promise<void> = async () => {};
vi.mock("../provider", () => ({
  hasAgentHost: () => true,
  hostedAccess: () => access(),
  refreshHostedAccess: vi.fn(async () => access()),
  ensureModels: async () => [{ id: "m", label: "M", description: "", efforts: ["medium"], defaultEffort: "medium", isDefault: true }],
  resolveModel: (list: Array<{ id: string }>) => list[0],
  resolveCheckModel: () => ({ id: "check", label: "Check", description: "", efforts: ["medium"], defaultEffort: "medium", isDefault: false }),
  getProvider: () => ({
    id: "fake",
    async openThread(options: OpenThreadOptions) {
      opened.push(options);
      return {
        id: "t",
        async run(_input: string, turnOptions: { model: string }, onEvent: (event: AgentEvent) => void) {
          runModels.push(turnOptions.model);
          await turn(options.tools, onEvent);
          return { status: "completed" as const };
        },
        interrupt: async () => {},
        close: async () => {},
      };
    },
  }),
}));

vi.mock("../instructions", () => ({
  chatInstructions: async () => "CHAT INSTRUCTIONS",
  currentPace: () => ({ wpm: 150 }),
}));

let blocks: AgentBlock[] = [];
vi.mock("../../../components/Agent/editorBridge", () => ({ liveBlocks: () => blocks }));

const { agentSettings, startAgentSettingsRuntime } = await import("../../agentSettings");
const claims = await import("../claims");

function memoryKv(initial: Record<string, string> = {}): KvStore & { appState: Map<string, string> } {
  const settings = new Map(Object.entries(initial));
  const appState = new Map<string, string>();
  return {
    appState,
    getAppState: async (key: string) => appState.get(key) ?? null,
    setAppState: async (key: string, value: string) => { appState.set(key, value); },
    getSetting: async (key: string) => settings.get(key) ?? null,
    setSetting: async (key: string, value: string) => { settings.set(key, value); },
  } as unknown as KvStore & { appState: Map<string, string> };
}

const script: AgentBlock[] = [
  { type: "character", text: "Axel" },
  { type: "dialog", text: "Resturlaub verfällt am 31. Dezember. Immer." },
  { type: "character", text: "Timo" },
  { type: "dialog", text: "Hmm." },
  { type: "character", text: "Axel" },
  { type: "dialog", text: "Deutschland hat die meisten Feiertage in Europa." },
];

let stop: (() => void) | undefined;
let kv: ReturnType<typeof memoryKv>;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  kv = memoryKv({ "agent.enabled": "1", "agent.onboarded": "1" });
  setKvStore(kv);
  stop = startAgentSettingsRuntime(kv);
  await agentSettings.load();
  setSignedIn(true);
  setAccess(true);
  decide.mockReset();
  decide.mockResolvedValue({});
  opened = [];
  runModels = [];
  blocks = script;
  claims.resetClaimsForTests();
});

afterEach(() => {
  stop?.();
  stop = undefined;
});

describe("claimScanAllowed", () => {
  it("needs the agent on, a signed-in account and AI access", async () => {
    expect(claims.claimScanAllowed()).toBe(true);
    setAccess(false);
    expect(claims.claimScanAllowed()).toBe(false);
    setAccess(true);
    setSignedIn(false);
    expect(claims.claimScanAllowed()).toBe(false);
    setSignedIn(true);
    await agentSettings.setHidden(true);
    expect(claims.claimScanAllowed()).toBe(false);
    await agentSettings.setHidden(false);
    await agentSettings.setEnabled(false);
    expect(claims.claimScanAllowed()).toBe(false);
  });
});

describe("createClaimScanner", () => {
  it("asks nothing while not allowed", async () => {
    setAccess(false);
    const scanner = claims.createClaimScanner("s1");
    scanner.update(script);
    await flush();
    expect(decide).not.toHaveBeenCalled();
    scanner.dispose();
  });

  it("asks about all lines when opening, then only about edited ones", async () => {
    decide.mockResolvedValueOnce({ b1: { type: "noul", noul: 0.95 }, b5: { type: "noul", noul: 0.4 } });
    const scanner = claims.createClaimScanner("s1");
    scanner.update(script);
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(Object.keys(decide.mock.calls[0][0].questions)).toEqual(["b1", "b5"]);
    expect(claims.lineState("s1", script[1].text).probability).toBe(0.95);
    expect(claims.lineState("s1", script[5].text).probability).toBe(0.4);

    // Unchanged lines are not asked again; an edited one goes with its neighbours.
    const edited = script.map((block, i) => (i === 5 ? { ...block, text: "Deutschland hat neun gesetzliche Feiertage." } : block));
    decide.mockResolvedValueOnce({ b5: { type: "noul", noul: 0.9 } });
    scanner.update(edited);
    await flush();
    expect(decide).toHaveBeenCalledTimes(2);
    const request = decide.mock.calls[1][0];
    expect(Object.keys(request.questions)).toEqual(["b5"]);
    expect(request.state.script).toContain("[1] DIALOG (AXEL): Resturlaub verfällt");
    scanner.dispose();
  });

  it("waits with the line being written until the caret leaves it", async () => {
    decide.mockResolvedValueOnce({ b1: { type: "noul", noul: 0.95 } });
    const scanner = claims.createClaimScanner("s1");
    scanner.update(script, { editing: 5 });
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(Object.keys(decide.mock.calls[0][0].questions)).toEqual(["b1"]);

    // Still in it: nothing. Left: that line alone, with its neighbours.
    scanner.update(script, { editing: 5 });
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    decide.mockResolvedValueOnce({ b5: { type: "noul", noul: 0.3 } });
    scanner.update(script, { editing: null });
    await flush();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(Object.keys(decide.mock.calls[1][0].questions)).toEqual(["b5"]);
    scanner.dispose();
  });

  it("keeps the answer after a small edit and asks again after a rewrite", async () => {
    const ids = script.map((_, i) => `k${i}`);
    decide.mockResolvedValueOnce({ b1: { type: "noul", noul: 0.95 }, b5: { type: "noul", noul: 0.4 } });
    const scanner = claims.createClaimScanner("s1");
    scanner.update(script, { ids });
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);

    const withLine1 = (text: string) => script.map((block, i) => (i === 1 ? { ...block, text } : block));
    const typo = withLine1("Resturlaub verfällt am 31. Dezember. Imer.");
    scanner.update(typo, { ids });
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(claims.lineState("s1", typo[1].text).probability).toBe(0.95);

    // Small edits do not add up: the comparison stays with the asked text.
    const drifted = withLine1("Resturlaub verfällt nie, im Dezember. Imer.");
    scanner.update(drifted, { ids });
    await flush();
    expect(decide).toHaveBeenCalledTimes(2);
    expect(Object.keys(decide.mock.calls[1][0].questions)).toEqual(["b1"]);
    scanner.dispose();
  });

  it("scans only the newest state when several updates wait for the device", async () => {
    const scanner = claims.createClaimScanner("s4");
    scanner.update(script, { editing: null });
    scanner.update(script, { editing: 5 });
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(Object.keys(decide.mock.calls[0][0].questions)).toEqual(["b1"]);
    scanner.dispose();
  });

  it("remembers answers on the device, so opening again asks nothing", async () => {
    decide.mockResolvedValueOnce({ b1: { type: "noul", noul: 0.95 } });
    const first = claims.createClaimScanner("s3");
    first.update(script);
    await flush();
    first.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.parse(kv.appState.get("script.s3.claims_scan") ?? "{}")).toEqual({
      [claimKey(script[1].text)]: 0.95,
      // No answer counts as no claim.
      [claimKey(script[5].text)]: 0,
    });

    claims.resetClaimsForTests();
    const again = claims.createClaimScanner("s3");
    again.update(script);
    await flush();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(claims.lineState("s3", script[1].text).probability).toBe(0.95);
    again.dispose();
  });
});

describe("checkClaim", () => {
  it("checks one line in a background thread with two tools and keeps the result", async () => {
    turn = async (tools, onEvent) => {
      onEvent({ type: "tool-start", itemId: "1", tool: "get_current_script", args: {} });
      const report = tools.find((tool) => tool.name === "report_fact_check");
      await report?.run({
        claims: [{
          quote: "Resturlaub verfällt am 31. Dezember.",
          verdict: "wrong",
          explanation: "Nur nach rechtzeitigem Hinweis des Arbeitgebers.",
          sources: [{ url: "https://www.bundesarbeitsgericht.de/x", title: "BAG" }],
        }],
      });
      onEvent({ type: "message", itemId: "2", text: "Geprüft." });
    };
    await claims.checkClaim("s1", 1, script[1].text);
    expect(opened).toHaveLength(1);
    expect(opened[0].ephemeral).toBe(true);
    expect(opened[0].instructions).toBe("CHAT INSTRUCTIONS");
    expect(opened[0].tools.map((tool) => tool.name).sort()).toEqual(["get_current_script", "report_fact_check"]);
    expect(runModels).toEqual(["check"]);
    const check = claims.lineState("s1", script[1].text).check;
    expect(check).toMatchObject({ state: "done", note: "Geprüft.", claim: { verdict: "wrong", quote: "Resturlaub verfällt am 31. Dezember." } });
  });

  it("keeps a check without claim as done with the agent's note", async () => {
    turn = async (_tools, onEvent) => onEvent({ type: "message", itemId: "1", text: "Keine prüfbare Behauptung." });
    await claims.checkClaim("s1", 5, script[5].text);
    expect(claims.lineState("s1", script[5].text).check).toMatchObject({ state: "done", claim: null, note: "Keine prüfbare Behauptung." });
  });
});

describe("resolveClaim", () => {
  it("hides a line for good on this device and can be undone", async () => {
    claims.resolveClaim("s1", script[1].text);
    expect(claims.lineState("s1", script[1].text).resolved).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(JSON.parse(kv.appState.get("script.s1.claims_resolved") ?? "[]")).toHaveLength(1);

    claims.unresolveClaim("s1", script[1].text, null);
    expect(claims.lineState("s1", script[1].text).resolved).toBe(false);
  });

  it("loads what was resolved before", async () => {
    claims.resolveClaim("s2", script[5].text);
    await new Promise((resolve) => setTimeout(resolve, 10));
    claims.resetClaimsForTests();
    expect(claims.lineState("s2", script[5].text).resolved).toBe(false);
    await claims.loadClaims("s2");
    expect(claims.lineState("s2", script[5].text).resolved).toBe(true);
  });
});
