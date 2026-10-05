import { describe, expect, it } from "vitest";
import { AGENT_JOBS, isAgentJob, jobInstruction, voiceInstruction } from "../jobs";
import { parseProposal } from "../proposals";

const ctx = { range: "0:45-1:05", runtime: "1:12", wpm: 210 };

describe("agent jobs", () => {
  it("has an instruction for every job", () => {
    for (const job of AGENT_JOBS) expect(jobInstruction(job, ctx).length).toBeGreaterThan(40);
  });

  it("starts the hook clock at the first line of dialog and asks for conflict indices", () => {
    const text = jobInstruction("hook", ctx);
    expect(text).toContain("first line of dialog");
    expect(text).toContain("conflict_block");
    expect(text).toContain("current_conflict_block");
  });

  it("gives the shortening job the runtime and the target range", () => {
    const text = jobInstruction("cut", ctx);
    expect(text).toContain("1:12");
    expect(text).toContain("0:45-1:05");
    expect(jobInstruction("cut", { ...ctx, range: "" })).not.toContain("target range is");
  });

  it("recognises job ids and names the character in voice rewrites", () => {
    expect(isAgentJob("tempo")).toBe(true);
    expect(isAgentJob("nope")).toBe(false);
    expect(voiceInstruction("AXEL")).toContain("AXEL");
  });
});

describe("conflict indices on proposals", () => {
  const option = (conflict?: number) => ({
    title: "A",
    blocks: [{ type: "character", text: "AXEL" }, { type: "dialog", text: "Es ist 13 Uhr." }],
    ...(conflict === undefined ? {} : { conflict_block: conflict }),
  });

  it("keeps valid indices and drops ones outside the option or script", () => {
    const parsed = parseProposal({ target: { mode: "replace", from: 1, to: 3 }, current_conflict_block: 4, options: [option(1), option(7)] }, 6);
    expect(parsed?.currentConflict).toBe(4);
    expect(parsed?.options[0].conflictBlock).toBe(1);
    expect(parsed?.options[1].conflictBlock).toBeUndefined();
    expect(parseProposal({ target: { mode: "append" }, current_conflict_block: 9, options: [option()] }, 6)?.currentConflict).toBeUndefined();
  });
});
