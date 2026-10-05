import { describe, expect, it } from "vitest";
import type { AgentBlock } from "../../../lib/agent/scriptText";
import type { Proposal } from "../../../lib/agent/proposals";
import { applyOption, measureBlocks, optionMetrics } from "../proposalMetrics";

const WPM = 120; // 2 words per second
const b = (type: AgentBlock["type"], text: string): AgentBlock => ({ type, text });

const script: AgentBlock[] = [
  b("action", "Timo tippt."), // 2 s, before the first dialog
  b("character", "AXEL"),
  b("dialog", "Morgen Timo"), // 1 s
  b("character", "TIMO"),
  b("dialog", "Morgen"), // 0.5 s
  b("character", "AXEL"),
  b("dialog", "Es ist dreizehn Uhr"), // 2 s - the conflict
];

describe("measureBlocks", () => {
  it("counts runtime, speaker changes and the time to the conflict from the first dialog", () => {
    const m = measureBlocks(script, WPM, 5);
    expect(m.runtimeSec).toBe(6);
    expect(m.speakerChanges).toBe(2);
    expect(m.longestSec).toBeCloseTo(2);
    expect(m.conflictSec).toBeCloseTo(1.5);
  });
});

describe("optionMetrics", () => {
  const proposal: Proposal = {
    target: { mode: "replace", from: 1, to: 6 },
    currentConflict: 5,
    options: [{ title: "Direkt", note: "", blocks: [b("character", "AXEL"), b("dialog", "Es ist dreizehn Uhr")], conflictBlock: 0 }],
  };

  it("compares the script before and after the option", () => {
    const m = optionMetrics(script, proposal, 0, WPM);
    expect(m?.before.conflictSec).toBeCloseTo(1.5);
    expect(m?.after.conflictSec).toBe(0);
    expect(m?.after.runtimeSec).toBe(5);
    expect(m?.after.speakerChanges).toBe(0);
  });

  it("is null when the targeted lines changed in the meantime", () => {
    const anchored: Proposal = { ...proposal, target: { mode: "replace", from: 1, to: 6, anchor: ["X", "Y", "Z", "1", "2", "3"] } };
    expect(optionMetrics(script, anchored, 0, WPM)).toBeNull();
  });

  it("applies insert and append like the editor bridge", () => {
    expect(applyOption(script.slice(0, 2), { mode: "insertAfter", block: 0 }, [b("action", "x")]).map((x) => x.text)).toEqual(["Timo tippt.", "x", "AXEL"]);
    expect(applyOption(script.slice(0, 1), { mode: "append" }, [b("action", "y")]).map((x) => x.text)).toEqual(["Timo tippt.", "y"]);
  });
});
