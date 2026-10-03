// Tests for the length goal range helpers (lib/lengthGoal.ts).

import { beforeAll, describe, expect, it } from "vitest";
import { applyResolvedLanguage } from "@agentz/kit/i18n";
import {
  folderHasLengthRange,
  formatClock,
  formatRange,
  lengthStatus,
  parseClock,
  resolveLengthRange,
} from "../lengthGoal";
import type { Folder } from "../types";

function folder(min: number | null, max: number | null): Folder {
  return {
    id: "f1",
    name: "Büro-Sketche",
    created_at: 0,
    updated_at: 0,
    script_count: 0,
    length_min_sec: min,
    length_max_sec: max,
  };
}

const NO_DEFAULT = { minSec: null, maxSec: null };

describe("resolveLengthRange", () => {
  it("prefers the folder range", () => {
    expect(resolveLengthRange(folder(45, 65), { minSec: 30, maxSec: 60 })).toEqual({
      minSec: 45,
      maxSec: 65,
    });
  });

  it("uses a folder with only one bound as its own range", () => {
    expect(resolveLengthRange(folder(null, 60), { minSec: 30, maxSec: 90 })).toEqual({
      minSec: null,
      maxSec: 60,
    });
  });

  it("falls back to the defaults when the folder has no range", () => {
    expect(resolveLengthRange(folder(null, null), { minSec: 30, maxSec: 60 })).toEqual({
      minSec: 30,
      maxSec: 60,
    });
    expect(resolveLengthRange(null, { minSec: null, maxSec: 60 })).toEqual({
      minSec: null,
      maxSec: 60,
    });
  });

  it("returns null when neither folder nor defaults set a bound", () => {
    expect(resolveLengthRange(folder(null, null), NO_DEFAULT)).toBeNull();
    expect(resolveLengthRange(null, NO_DEFAULT)).toBeNull();
  });

  it("drops the lower bound of an inverted default", () => {
    expect(resolveLengthRange(null, { minSec: 90, maxSec: 60 })).toEqual({
      minSec: null,
      maxSec: 60,
    });
  });

  it("folderHasLengthRange", () => {
    expect(folderHasLengthRange(folder(null, null))).toBe(false);
    expect(folderHasLengthRange(folder(10, null))).toBe(true);
    expect(folderHasLengthRange(null)).toBe(false);
  });
});

describe("lengthStatus", () => {
  const range = { minSec: 45, maxSec: 65 };

  it("over: delta to the upper bound", () => {
    expect(lengthStatus(75, range)).toEqual({ state: "over", deltaSec: 10 });
  });

  it("under: delta to the lower bound", () => {
    expect(lengthStatus(38, range)).toEqual({ state: "under", deltaSec: 7 });
  });

  it("in: bounds are inclusive", () => {
    expect(lengthStatus(45, range)).toEqual({ state: "in", deltaSec: 0 });
    expect(lengthStatus(65, range)).toEqual({ state: "in", deltaSec: 0 });
    expect(lengthStatus(52, range)).toEqual({ state: "in", deltaSec: 0 });
  });

  it("compares in whole seconds", () => {
    expect(lengthStatus(65.4, range)).toEqual({ state: "in", deltaSec: 0 });
    expect(lengthStatus(65.6, range)).toEqual({ state: "over", deltaSec: 1 });
  });

  it("max only: never under", () => {
    expect(lengthStatus(3, { minSec: null, maxSec: 60 })).toEqual({ state: "in", deltaSec: 0 });
    expect(lengthStatus(61, { minSec: null, maxSec: 60 })).toEqual({ state: "over", deltaSec: 1 });
  });

  it("min only: never over", () => {
    expect(lengthStatus(999, { minSec: 45, maxSec: null })).toEqual({ state: "in", deltaSec: 0 });
    expect(lengthStatus(40, { minSec: 45, maxSec: null })).toEqual({ state: "under", deltaSec: 5 });
  });

  it("none without range", () => {
    expect(lengthStatus(75, null)).toEqual({ state: "none", deltaSec: 0 });
    expect(lengthStatus(75, NO_DEFAULT)).toEqual({ state: "none", deltaSec: 0 });
  });
});

describe("formatClock / formatRange / parseClock", () => {
  beforeAll(() => applyResolvedLanguage("de"));

  it("formats m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(600)).toBe("10:00");
  });

  it("formats ranges in German", () => {
    applyResolvedLanguage("de");
    expect(formatRange({ minSec: 45, maxSec: 65 })).toBe("0:45-1:05");
    expect(formatRange({ minSec: null, maxSec: 60 })).toBe("bis 1:00");
    expect(formatRange({ minSec: 45, maxSec: null })).toBe("ab 0:45");
    expect(formatRange(null)).toBe("");
    expect(formatRange(NO_DEFAULT)).toBe("");
  });

  it("formats ranges in English", () => {
    applyResolvedLanguage("en");
    expect(formatRange({ minSec: null, maxSec: 60 })).toBe("up to 1:00");
    expect(formatRange({ minSec: 45, maxSec: null })).toBe("from 0:45");
    applyResolvedLanguage("de");
  });

  it("parses user input", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("  ")).toBeNull();
    expect(parseClock("1:05")).toBe(65);
    expect(parseClock("0:45")).toBe(45);
    expect(parseClock("90")).toBe(90);
    expect(parseClock("1:75")).toBeUndefined();
    expect(parseClock("abc")).toBeUndefined();
  });
});
