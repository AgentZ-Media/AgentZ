// Adaptive writing counter.
//
// Shows the smallest time window that actually contains written words:
// this week -> this month -> this year -> total. A quiet week therefore
// doesn't read as "0 words" but falls back to the month, and so on. No
// goal, no streak - just "what have I written lately".
//
// Inputs come from DailyStatsSummary (lib/dailyWords.ts or the adapter's
// loadDailyStats):
//  - week:  `wordsThisWeek` (ISO week, since Monday 00:00)
//  - month: sum of `dailyWords` since the 1st of `now`'s month
//  - year:  sum of `dailyWords` since Jan 1st of `now`'s year
//  - total: `totalWords` (the 365-day window the stats cover)
// `dailyWords` is the 365-day series, oldest first, today last.

import type { DailyStatsSummary } from "./types";

export type WritingWindow = "week" | "month" | "year" | "total" | "none";

export interface WritingWindowPick {
  words: number;
  window: WritingWindow;
  all: { week: number; month: number; year: number; total: number };
}

function sumLastDays(series: number[], days: number): number {
  if (days <= 0 || series.length === 0) return 0;
  let sum = 0;
  for (let i = Math.max(0, series.length - days); i < series.length; i++) {
    const v = series[i];
    if (Number.isFinite(v) && v > 0) sum += v;
  }
  return sum;
}

/** Days from Jan 1st (inclusive) to `now` (inclusive), local time. */
function dayOfYear(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Round to absorb DST shifts (23/25-hour days).
  return Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function pickWritingWindow(
  stats: DailyStatsSummary,
  now: Date = new Date(),
): WritingWindowPick {
  const series = stats.dailyWords ?? [];
  const week = Math.max(0, stats.wordsThisWeek ?? 0);
  const month = sumLastDays(series, now.getDate());
  const year = sumLastDays(series, dayOfYear(now));
  const total = Math.max(0, stats.totalWords ?? 0);
  const all = { week, month, year, total };
  if (week > 0) return { words: week, window: "week", all };
  if (month > 0) return { words: month, window: "month", all };
  if (year > 0) return { words: year, window: "year", all };
  if (total > 0) return { words: total, window: "total", all };
  return { words: 0, window: "none", all };
}
