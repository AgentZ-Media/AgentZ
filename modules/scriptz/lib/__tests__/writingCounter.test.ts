// Tests for the adaptive writing counter (lib/writingCounter.ts).

import { describe, expect, it } from "vitest";
import { pickWritingWindow } from "../writingCounter";
import type { DailyStatsSummary } from "../types";

/** Builds a 365-day series ending at `now` with words on the given
 *  "days ago" offsets (0 = today). */
function stats(
  wordsByDaysAgo: Record<number, number>,
  wordsThisWeek: number,
): DailyStatsSummary {
  const series = new Array<number>(365).fill(0);
  for (const [ago, w] of Object.entries(wordsByDaysAgo)) {
    series[364 - Number(ago)] = w;
  }
  const totalWords = series.reduce((a, b) => a + b, 0);
  return {
    wordsToday: series[364],
    wordsThisWeek,
    streakDays: 0,
    dailyWords: series,
    activeDays: series.filter((w) => w > 0).length,
    totalWords,
  };
}

// Wednesday 2026-10-14 (14th day of the month, day 287 of the year).
const NOW = new Date(2026, 9, 14, 12, 0, 0);

describe("pickWritingWindow", () => {
  it("prefers the week when it has words", () => {
    const r = pickWritingWindow(stats({ 0: 100, 1: 50, 20: 400 }, 150), NOW);
    expect(r.window).toBe("week");
    expect(r.words).toBe(150);
    expect(r.all.week).toBe(150);
  });

  it("falls back to the month", () => {
    // 10 days ago = Oct 4th (this month), but not this week.
    const r = pickWritingWindow(stats({ 10: 300 }, 0), NOW);
    expect(r).toEqual({
      words: 300,
      window: "month",
      all: { week: 0, month: 300, year: 300, total: 300 },
    });
  });

  it("falls back to the year", () => {
    // 14 days ago = Sep 30th: outside the month (Oct 1-14), inside the year.
    const r = pickWritingWindow(stats({ 14: 80, 200: 20 }, 0), NOW);
    expect(r.window).toBe("year");
    expect(r.words).toBe(100);
    expect(r.all.month).toBe(0);
  });

  it("counts the 1st of the month into the month window", () => {
    // 13 days ago = Oct 1st.
    const r = pickWritingWindow(stats({ 13: 42 }, 0), NOW);
    expect(r.window).toBe("month");
    expect(r.words).toBe(42);
  });

  it("falls back to the total (words only in last year)", () => {
    // 300 days ago is in 2025.
    const r = pickWritingWindow(stats({ 300: 900 }, 0), NOW);
    expect(r.window).toBe("total");
    expect(r.words).toBe(900);
    expect(r.all.year).toBe(0);
  });

  it("returns none for a fresh user", () => {
    const r = pickWritingWindow(stats({}, 0), NOW);
    expect(r).toEqual({
      words: 0,
      window: "none",
      all: { week: 0, month: 0, year: 0, total: 0 },
    });
  });

  it("copes with an empty series", () => {
    const r = pickWritingWindow(
      {
        wordsToday: 0,
        wordsThisWeek: 0,
        streakDays: 0,
        dailyWords: [],
        activeDays: 0,
        totalWords: 0,
      },
      NOW,
    );
    expect(r.window).toBe("none");
  });
});
