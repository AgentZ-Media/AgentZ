import { afterEach, describe, expect, it } from "vitest";
import { STAGE_GLYPHS, stageGlyph } from "@agentz/design/icons";
import {
  DEFAULT_STAGES,
  finalStageId,
  firstStageId,
  isFinalStage,
  isKnownStage,
  parseStages,
  resetScriptStages,
  resolveStageId,
  scriptStages,
  serializeStages,
  setScriptStages,
  stageIndex,
  stageLabel,
} from "../stages";

afterEach(() => resetScriptStages());

describe("stage list parsing", () => {
  it("uses the shipped pipeline when nothing is stored", () => {
    expect(parseStages(null)).toEqual(DEFAULT_STAGES);
    expect(parseStages("")).toEqual(DEFAULT_STAGES);
  });

  it("round-trips a custom list", () => {
    const list = [{ id: "writing" }, { id: "ready", label: "Fertig geschrieben" }, { id: "c-1", label: "Gedreht" }];
    expect(parseStages(serializeStages(list))).toEqual(list);
  });

  it("falls back to the default for broken values", () => {
    for (const raw of [
      "not json",
      "{}",
      '[{"id":"writing"}]', // fewer than two stages
      '[{"id":"writing"},{"id":"writing"}]', // duplicate id
      '[{"id":"writing"},{"id":"c-1"}]', // custom stage without a name
      '[{"id":"writing"},{"id":"idea","label":"Idee"}]', // reserved id
      JSON.stringify(Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, label: `S${i}` }))),
    ]) {
      expect(parseStages(raw)).toEqual(DEFAULT_STAGES);
    }
  });

  it("drops blank own names of built-in stages", () => {
    expect(parseStages('[{"id":"writing","label":"  "},{"id":"shot"}]')).toEqual([{ id: "writing" }, { id: "shot" }]);
  });
});

describe("active pipeline", () => {
  it("resolves first, last, positions and names", () => {
    setScriptStages([{ id: "writing" }, { id: "ready", label: "Fertig" }, { id: "c-1", label: "Gedreht" }]);
    expect(firstStageId()).toBe("writing");
    expect(finalStageId()).toBe("c-1");
    expect(stageIndex("ready")).toBe(1);
    expect(isFinalStage("c-1")).toBe(true);
    expect(isFinalStage("ready")).toBe(false);
    expect(stageLabel("ready")).toBe("Fertig");
    expect(stageLabel("c-1")).toBe("Gedreht");
  });

  it("treats removed stages as the first stage", () => {
    setScriptStages([{ id: "writing" }, { id: "ready" }, { id: "shot" }]);
    expect(isKnownStage("online")).toBe(false);
    expect(resolveStageId("online")).toBe("writing");
    expect(resolveStageId(null)).toBe("writing");
    expect(stageIndex("online")).toBe(0);
  });

  it("ignores invalid lists", () => {
    setScriptStages([{ id: "writing" }]);
    expect(scriptStages()).toEqual(DEFAULT_STAGES);
  });
});

describe("stage glyph", () => {
  it("reproduces the four shipped glyphs", () => {
    expect(stageGlyph(0, 4)).toBe(STAGE_GLYPHS.idea);
    expect(stageGlyph(1, 4)).toBe(STAGE_GLYPHS.writing);
    // Same half disc as STAGE_GLYPHS.ready, written as a wedge from the centre.
    expect(stageGlyph(2, 4)).toContain('d="M7 7V3.4A3.6 3.6 0 0 1 7 10.6z"');
    expect(stageGlyph(3, 4)).toBe(STAGE_GLYPHS.shot);
    expect(stageGlyph(4, 4)).toBe(STAGE_GLYPHS.online);
  });

  it("fills by step / total and marks the last step as done", () => {
    // A third of the ring ends at 120 degrees.
    expect(stageGlyph(1, 3)).toContain('A3.6 3.6 0 0 1 10.118 8.8z');
    expect(stageGlyph(2, 3)).toContain('A3.6 3.6 0 1 1 3.882 8.8z');
    expect(stageGlyph(3, 3)).toBe(STAGE_GLYPHS.online);
    expect(stageGlyph(9, 10)).toContain("0 1 1");
    expect(stageGlyph(10, 10)).toBe(STAGE_GLYPHS.online);
  });
});
