// Tests for the per-block timeline (lib/timing.ts). The key invariant: the
// timeline uses the same formula as lib/runtime.ts, so the sum of all
// segment durations matches the runtime shown everywhere else.

import { beforeAll, describe, expect, it } from "vitest";
import { applyResolvedLanguage } from "../../i18n";
import {
  computeTimeline,
  timingBlocksFromContentJson,
  type TimingBlock,
} from "../timing";
import {
  MIN_RUNTIME_SEC,
  runtimeSeconds,
  runtimeStatsFromContent,
} from "../runtime";

beforeAll(() => {
  applyResolvedLanguage("de");
});

function lex(blocks: Array<{ kind: string; text: string }>): string {
  return JSON.stringify({
    root: {
      children: blocks.map((b) => ({
        type: b.kind,
        children: b.text ? [{ type: "text", text: b.text }] : [],
      })),
    },
  });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("computeTimeline", () => {
  it("gives dialog words/wpm, 2 s per action, 0 s per character", () => {
    const blocks: TimingBlock[] = [
      { key: "a", kind: "action", text: "Büro." },
      { key: "c1", kind: "character", text: "lena" },
      { key: "d1", kind: "dialog", text: "eins zwei drei vier fünf sechs" },
      { key: "c2", kind: "character", text: "TOM" },
      { key: "d2", kind: "dialog", text: "ja" },
    ];
    const segs = computeTimeline(blocks, 120); // 2 words per second
    expect(segs).toEqual([
      { key: "a", kind: "action", speaker: null, startSec: 0, durSec: 2, text: "Büro." },
      { key: "d1", kind: "dialog", speaker: "LENA", startSec: 2, durSec: 3, text: "eins zwei drei vier fünf sechs" },
      { key: "d2", kind: "dialog", speaker: "TOM", startSec: 5, durSec: 0.5, text: "ja" },
    ]);
  });

  it("keeps the speaker across action blocks (like dialogWordsByCharacter)", () => {
    const segs = computeTimeline(
      [
        { kind: "character", text: "Max" },
        { kind: "action", text: "(leise)" },
        { kind: "dialog", text: "Hallo" },
      ],
      60,
    );
    expect(segs.map((s) => [s.kind, s.speaker])).toEqual([
      ["action", null],
      ["dialog", "MAX"],
    ]);
  });

  it("counts empty action blocks and skips word-less dialog", () => {
    const segs = computeTimeline(
      [
        { kind: "action", text: "" },
        { kind: "dialog", text: "   " },
        { kind: "dialog", text: "Hallo" },
      ],
      60,
    );
    expect(segs.map((s) => [s.kind, s.startSec, s.durSec])).toEqual([
      ["action", 0, 2],
      ["dialog", 2, 1],
    ]);
  });

  it("clamps a non-positive wpm like runtime.ts", () => {
    const segs = computeTimeline([{ kind: "dialog", text: "a b" }], 0);
    expect(segs[0].durSec).toBe(120); // 2 words / 1 wpm
  });
});

describe("timeline sum equals runtime", () => {
  const cases: Array<{ name: string; wpm: number; blocks: Array<{ kind: string; text: string }> }> = [
    {
      name: "sketch",
      wpm: 210,
      blocks: [
        { kind: "scriptz-action", text: "Büro, Montagmorgen." },
        { kind: "scriptz-character", text: "LENA" },
        { kind: "scriptz-dialog", text: "Wer hat den letzten Kaffee getrunken und keinen neuen gemacht?" },
        { kind: "scriptz-character", text: "TOM" },
        { kind: "scriptz-parenthetical", text: "unschuldig" },
        { kind: "scriptz-dialog", text: "Ich trinke Tee. Seit heute." },
        { kind: "scriptz-camera", text: "Close-Up" },
        { kind: "scriptz-action", text: "" },
      ],
    },
    {
      name: "long monologue",
      wpm: 150,
      blocks: [
        { kind: "scriptz-character", text: "ERZÄHLER" },
        { kind: "scriptz-dialog", text: Array.from({ length: 333 }, (_, i) => `w${i}`).join(" ") },
        { kind: "scriptz-action", text: "Ende." },
      ],
    },
  ];

  for (const c of cases) {
    it(`matches runtimeSeconds for "${c.name}"`, () => {
      const json = lex(c.blocks);
      const segs = computeTimeline(timingBlocksFromContentJson(json), c.wpm);
      const total = sum(segs.map((s) => s.durSec));
      const runtime = runtimeSeconds(runtimeStatsFromContent(json), c.wpm);
      expect(Math.max(MIN_RUNTIME_SEC, Math.round(total))).toBe(runtime);
      // Segments are contiguous: each starts where the previous ended.
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i].startSec).toBeCloseTo(segs[i - 1].startSec + segs[i - 1].durSec, 9);
      }
    });
  }

  it("applies the 5 s minimum to the total only, segments stay unscaled", () => {
    const json = lex([
      { kind: "scriptz-character", text: "MAX" },
      { kind: "scriptz-dialog", text: "Hi" },
    ]);
    const segs = computeTimeline(timingBlocksFromContentJson(json), 210);
    const total = sum(segs.map((s) => s.durSec));
    expect(total).toBeLessThan(1);
    expect(runtimeSeconds(runtimeStatsFromContent(json), 210)).toBe(MIN_RUNTIME_SEC);
  });
});

describe("timingBlocksFromContentJson", () => {
  it("maps block kinds and converts retired types to action", () => {
    const json = lex([
      { kind: "scriptz-sfx", text: "Pling" },
      { kind: "scriptz-character", text: "MAX" },
      { kind: "scriptz-dialog", text: "Hallo" },
    ]);
    expect(timingBlocksFromContentJson(json)).toEqual([
      { kind: "action", text: "Pling" },
      { kind: "character", text: "MAX" },
      { kind: "dialog", text: "Hallo" },
    ]);
  });

  it("returns [] for malformed JSON", () => {
    expect(timingBlocksFromContentJson("{nope")).toEqual([]);
  });
});
