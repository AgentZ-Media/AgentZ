// Daily word logging - feeds the writing counter and the activity heatmap.
//
// Two consumers:
//   1. Writing counter in the sidebar footer (adaptive week/month/year window)
//   2. Activity dialog with the 365-day heatmap (components/Activity)
// The streak value is computed for the stats summary but shown nowhere
// (no pressure features).
//
// Write path: lib/scripts.ts calls `recordWordDelta(delta)` on every save,
// after the diff against the last saved word count has been calculated.
// The helper here handles the date bucket. Negative
// deltas (deletions) are ignored - today counts as "newly written
// today", not as "net change".
//
// Read path: `loadStats()` fetches the last 365 days in one SELECT
// and builds streak + aggregate stats on top. The Solid store
// stores/dailyStats.ts caches the result and invalidates via the
// dailyStatsBus as soon as a save has recorded words.

import { extractBlocks } from "./lex";
import { getDb } from "./db";
import type { DailyStatsSummary, DailyWordEntry } from "./types";
import { dailyStatsBus } from "./dailyStatsBus";

/** ISO-like local date YYYY-MM-DD without UTC drift. */
export function localDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Word count of a Lexical script: splitting on whitespace, empty tokens are dropped.
 *  Block type is irrelevant - every text block counts. */
export function countWordsInContent(contentJson: string): number {
  const blocks = extractBlocks(contentJson);
  let total = 0;
  for (const b of blocks) {
    const text = b.text.trim();
    if (!text) continue;
    total += text.split(/\s+/).filter(Boolean).length;
  }
  return total;
}

/** Records a positive word delta into today's bucket. Callers
 *  must compute the delta against the last saved word count and
 *  clamp negative values. After a successful write the
 *  dailyStatsBus bumps so components re-read. */
export async function recordWordDelta(delta: number): Promise<void> {
  if (delta <= 0) return;
  const date = localDateKey();
  const db = await getDb();
  await db.execute(
    `INSERT INTO daily_word_log (date, words_added) VALUES ($1, $2)
     ON CONFLICT(date) DO UPDATE SET
       words_added = daily_word_log.words_added + excluded.words_added`,
    [date, delta],
  );
  dailyStatsBus.bump();
}

/** Returns the last N days (oldest first, today last) as a
 *  contiguous array - missing days in the DB are filled with 0. */
export async function loadDailyWords(days = 365): Promise<DailyWordEntry[]> {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  const startKey = localDateKey(start);
  const db = await getDb();
  const rows = await db.select<DailyWordEntry[]>(
    `SELECT date, words_added FROM daily_word_log
     WHERE date >= $1 ORDER BY date ASC`,
    [startKey],
  );
  const map = new Map(rows.map((r) => [r.date, r.words_added]));
  const out: DailyWordEntry[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = localDateKey(d);
    out.push({ date: key, words_added: map.get(key) ?? 0 });
  }
  return out;
}

function streakFromSeries(words: number[]): number {
  // Convention: streak ends today or at the latest yesterday. Today with 0
  // words does NOT break the streak - the day is still in progress. Only once
  // yesterday was also 0 is the streak considered broken.
  if (words.length === 0) return 0;
  const last = words.length - 1;
  let streak = 0;
  // If today is empty, start at yesterday.
  let i = words[last] === 0 ? last - 1 : last;
  while (i >= 0 && words[i] > 0) {
    streak++;
    i--;
  }
  return streak;
}

/** Number of days between the last Monday (incl.) and today (incl.).
 *  Monday = 1. Sunday = 7 (weekend counts toward the elapsed week).
 *  Convention matches ISO-8601 calendar week. */
function daysSinceMondayInclusive(d: Date = new Date()): number {
  // JavaScript: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
  // ISO: 1 = Monday, ..., 7 = Sunday. Mapping: 0 → 7, otherwise unchanged.
  const iso = d.getDay() === 0 ? 7 : d.getDay();
  return iso; // Mon = 1 day (today), Sun = 7 days (Mon..Sun)
}

export async function loadStats(): Promise<DailyStatsSummary> {
  const entries = await loadDailyWords(365);
  const series = entries.map((e) => e.words_added);
  const wordsToday = series.length > 0 ? series[series.length - 1] : 0;
  const weekDays = daysSinceMondayInclusive();
  const wordsThisWeek = series.slice(-weekDays).reduce((a, b) => a + b, 0);
  const streakDays = streakFromSeries(series);
  const activeDays = series.filter((w) => w > 0).length;
  const totalWords = series.reduce((a, b) => a + b, 0);
  return {
    wordsToday,
    wordsThisWeek,
    streakDays,
    dailyWords: series,
    activeDays,
    totalWords,
  };
}
