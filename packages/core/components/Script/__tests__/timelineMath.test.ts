// Tests for the pure script-screen helpers (components/Script/timelineMath.ts).

import { describe, expect, it } from "vitest";
import { computeTimeline, type TimingBlock } from "../../../lib/timing";
import { runtimeSeconds, runtimeStatsFromBlocks } from "../../../lib/runtime";
import type { ExtractedBlock } from "../../../lib/lex";
import {
  axisTicks,
  laneSpeakers,
  liveStats,
  longestDialogKey,
  pct,
  playheadSec,
  segmentsEnd,
  sinceBucket,
  textStart,
  timelineWindow,
} from "../timelineMath";

const WPM = 120; // 2 words per second - easy numbers

const blocks: TimingBlock[] = [
  { key: "a1", kind: "action", text: "Timo klappt den Laptop zu." },
  { key: "c1", kind: "character", text: "Timo" },
  { key: "d1", kind: "dialog", text: "So ich bin fertig" }, // 4 words = 2 s
  { key: "c2", kind: "character", text: "axel" },
  { key: "d2", kind: "dialog", text: "Hast du mal auf die Uhr geschaut" }, // 7 words = 3.5 s
  { key: "a2", kind: "action", text: "" },
  { key: "d3", kind: "dialog", text: "Nein" }, // still AXEL, 0.5 s
  { key: "c3", kind: "character", text: "TIMO" },
  { key: "d4", kind: "dialog", text: "" }, // empty, no segment
];

describe("liveStats", () => {
  it("counts words, dialog words, actions and speaker changes", () => {
    const s = liveStats(blocks, WPM);
    expect(s.words).toBe(5 + 1 + 4 + 1 + 7 + 1 + 1);
    expect(s.dialogWords).toBe(12);
    expect(s.actionBlocks).toBe(2);
    // TIMO -> AXEL (change), AXEL -> AXEL (no change)
    expect(s.speakerChanges).toBe(1);
  });

  it("matches lib/runtime.ts for the total", () => {
    const extracted: ExtractedBlock[] = blocks.map((b) => ({
      kind: `scriptz-${b.kind}`,
      text: b.text,
    })) as unknown as ExtractedBlock[];
    const expected = runtimeSeconds(runtimeStatsFromBlocks(extracted), WPM);
    expect(liveStats(blocks, WPM).runtimeSec).toBe(expected);
  });

  it("applies the 5 s floor", () => {
    expect(liveStats([], WPM).runtimeSec).toBe(5);
  });

  it("counts parenthetical words only towards the total, keeping the speaker", () => {
    const withParen: TimingBlock[] = [
      { key: "c1", kind: "character", text: "Timo" },
      { key: "p1", kind: "paren", text: "(leise)" },
      { key: "d1", kind: "dialog", text: "So ich bin fertig" },
      { key: "p2", kind: "paren", text: "(Pause)" },
      { key: "d2", kind: "dialog", text: "Wirklich" },
    ];
    const s = liveStats(withParen, WPM);
    expect(s.words).toBe(1 + 1 + 4 + 1 + 1);
    expect(s.dialogWords).toBe(5);
    expect(s.actionBlocks).toBe(0);
    expect(s.speakerChanges).toBe(0);
    expect(s.cast).toEqual([{ name: "TIMO", words: 5, pct: 100 }]);
    const extracted = withParen.map((b) => ({
      kind: b.kind === "paren" ? "scriptz-parenthetical" : `scriptz-${b.kind}`,
      text: b.text,
    })) as unknown as ExtractedBlock[];
    expect(s.runtimeSec).toBe(runtimeSeconds(runtimeStatsFromBlocks(extracted), WPM));
  });

  it("builds the cast sorted by share with whole percents", () => {
    const s = liveStats(blocks, WPM);
    expect(s.cast.map((c) => c.name)).toEqual(["AXEL", "TIMO"]);
    expect(s.cast[0]).toMatchObject({ words: 8, pct: 67 });
    expect(s.cast[1]).toMatchObject({ words: 4, pct: 33 });
  });

  it("lists characters without dialog at 0 %", () => {
    const s = liveStats([{ kind: "character", text: "Chef" }], WPM);
    expect(s.cast).toEqual([{ name: "CHEF", words: 0, pct: 0 }]);
  });
});

describe("timelineWindow", () => {
  it("adds air and rounds to 10 s", () => {
    // concept: 1:15 runtime, range 0:45-1:05 -> 80 s window
    expect(timelineWindow(75, { minSec: 45, maxSec: 65 })).toBe(80);
  });
  it("covers the upper bound when the script is short", () => {
    expect(timelineWindow(20, { minSec: 45, maxSec: 65 })).toBe(70);
  });
  it("works without a range", () => {
    expect(timelineWindow(5, null)).toBe(10);
    expect(timelineWindow(42, null)).toBe(50);
  });
});

describe("axisTicks", () => {
  it("uses 10 s steps for short windows", () => {
    expect(axisTicks(80)).toEqual({ step: 10, ticks: [0, 10, 20, 30, 40, 50, 60, 70] });
  });
  it("gets coarser for long windows", () => {
    const { step, ticks } = axisTicks(300);
    expect(step).toBe(30);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks[0]).toBe(0);
  });
});

describe("pct", () => {
  it("clamps to 0..100", () => {
    expect(pct(40, 80)).toBe(50);
    expect(pct(-1, 80)).toBe(0);
    expect(pct(120, 80)).toBe(100);
    expect(pct(5, 0)).toBe(0);
  });
});

describe("playheadSec", () => {
  const segs = computeTimeline(blocks, WPM);

  it("sits at the start of the caret block", () => {
    expect(playheadSec(blocks, segs, "d2")).toBeCloseTo(4); // 2 s action + 2 s TIMO
  });
  it("uses the next timed block for character lines", () => {
    expect(playheadSec(blocks, segs, "c2")).toBeCloseTo(4);
  });
  it("sits at the end past the last timed block", () => {
    expect(playheadSec(blocks, segs, "d4")).toBeCloseTo(segmentsEnd(segs));
    expect(segmentsEnd(segs)).toBeCloseTo(2 + 2 + 3.5 + 2 + 0.5);
  });
  it("uses the next timed block for a parenthetical", () => {
    const withParen: TimingBlock[] = [
      { key: "a1", kind: "action", text: "Los." },
      { key: "c1", kind: "character", text: "Timo" },
      { key: "p1", kind: "paren", text: "(leise)" },
      { key: "d1", kind: "dialog", text: "Hallo" },
    ];
    expect(playheadSec(withParen, computeTimeline(withParen, WPM), "p1")).toBeCloseTo(2);
  });
  it("is 0 without a caret", () => {
    expect(playheadSec(blocks, segs, null)).toBe(0);
    expect(playheadSec(blocks, segs, "nope")).toBe(0);
  });
});

describe("laneSpeakers / longestDialogKey", () => {
  it("orders speakers by first appearance", () => {
    const segs = computeTimeline(blocks, WPM);
    expect(laneSpeakers(segs)).toEqual({ speakers: ["TIMO", "AXEL"], hasUnnamed: false });
    expect(longestDialogKey(segs)).toBe("d2");
  });
  it("flags dialog without a character", () => {
    const segs = computeTimeline([{ key: "x", kind: "dialog", text: "Hallo du" }], WPM);
    expect(laneSpeakers(segs)).toEqual({ speakers: [], hasUnnamed: true });
  });
});

describe("textStart", () => {
  it("keeps short text and cuts long text on a word boundary", () => {
    expect(textStart("  Kurz  und   gut ")).toBe("Kurz und gut");
    const long = "Nix früher Feierabend. Nur weil du mit deinen Aufgaben fertig bist, heißt das nicht, dass du Feierabend hast.";
    const out = textStart(long, 60);
    expect(out.endsWith(" …")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(62);
  });
});

describe("sinceBucket", () => {
  const now = 1_000_000_000_000;
  it("buckets elapsed time", () => {
    expect(sinceBucket(now - 10_000, now)).toEqual({ unit: "now", count: 0 });
    expect(sinceBucket(now - 5 * 60_000, now)).toEqual({ unit: "minutes", count: 5 });
    expect(sinceBucket(now - 3 * 3_600_000, now)).toEqual({ unit: "hours", count: 3 });
    expect(sinceBucket(now - 2 * 86_400_000 - 1000, now)).toEqual({ unit: "days", count: 2 });
  });
});
