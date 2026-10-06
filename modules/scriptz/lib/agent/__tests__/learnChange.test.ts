import { describe, expect, it } from "vitest";
import { learnChange, relearnThreshold, worthRelearning } from "../learnChange";
import { learnText, type AgentBlock } from "../scriptText";

const script = (...blocks: [AgentBlock["type"], string][]) => learnText(blocks.map(([type, text]) => ({ type, text })));

const base = script(
  ["action", "Timo steht in der Bäckerei."],
  ["character", "TIMO"],
  ["dialog", "Ich hätte gern zwei Brötchen und ein Croissant, bitte."],
  ["character", "AXEL"],
  ["dialog", "Wir haben nur noch Schrippen, Wecken und Semmeln im Angebot."],
);

describe("learnChange", () => {
  it("finds nothing when the text is the same", () => {
    const change = learnChange(base, base);
    expect(change).toMatchObject({ changedWords: 0, newCharacters: [], changedLines: [] });
    expect(worthRelearning(change)).toBe(false);
  });

  it("ignores a typo fix", () => {
    const fixed = base.replace("Croissant", "Croisant");
    expect(learnChange(base, fixed).changedWords).toBe(1);
    expect(worthRelearning(learnChange(base, fixed))).toBe(false);
  });

  it("relearns after a new passage", () => {
    const longer = `${base}\n${script(
      ["character", "TIMO"],
      ["dialog", "Dann nehme ich eben alles, was hier irgendwie nach Brötchen aussieht und nicht weglaufen kann."],
    )}`;
    const change = learnChange(base, longer);
    expect(change.changedWords).toBeGreaterThanOrEqual(relearnThreshold(change.totalWords));
    expect(worthRelearning(change)).toBe(true);
    expect(change.changedLines).toEqual(["DIALOG (TIMO): Dann nehme ich eben alles, was hier irgendwie nach Brötchen aussieht und nicht weglaufen kann."]);
  });

  it("relearns when a new character appears", () => {
    const withGuest = base.replace("character:AXEL", "character:Bäckerin");
    const change = learnChange(base, withGuest);
    expect(change.newCharacters).toEqual(["BÄCKERIN"]);
    expect(worthRelearning(change)).toBe(true);
  });

  it("does not count moving a line as a change", () => {
    const lines = base.split("\n");
    const moved = [lines[1], lines[2], lines[0], lines[3], lines[4]].join("\n");
    expect(learnChange(base, moved)).toMatchObject({ changedWords: 0, changedLines: [] });
  });

  it("treats an empty earlier version as all new", () => {
    const change = learnChange("", base);
    expect(change.changedWords).toBe(change.totalWords);
    expect(change.newCharacters).toEqual(["TIMO", "AXEL"]);
  });

  it("keeps the threshold between a short sentence and a short passage", () => {
    expect(relearnThreshold(20)).toBe(6);
    expect(relearnThreshold(120)).toBe(12);
    expect(relearnThreshold(2000)).toBe(25);
  });
});
