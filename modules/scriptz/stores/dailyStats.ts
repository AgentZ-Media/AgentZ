import { createResource } from "solid-js";
import { api } from "../lib/api";
import { dailyStatsBus } from "../lib/dailyStatsBus";
import type { DailyStatsSummary } from "../lib/types";

// Heatmap and streak bar expect dailyWords with a fixed length of 365
// (one entry per day for the last 12 months). An empty array would
// reduce the heatmap grid to 0 cells and "grow it back" on refetch -
// cosmetically unclean, hence the fallback with zeros.
const EMPTY: DailyStatsSummary = {
  wordsToday: 0,
  wordsThisWeek: 0,
  streakDays: 0,
  dailyWords: Array(365).fill(0),
  activeDays: 0,
  totalWords: 0,
};

// Global resource slot. createResource lives at module top level so
// subscribers share the same cache - every component that needs the
// statistics calls `dailyStats()` without triggering a new roundtrip.
// On a bus bump (see lib/dailyStatsBus.ts) the resource refetches
// transparently.
const [stats] = createResource(
  () => dailyStatsBus.version(),
  async () => {
    try {
      return await api.loadDailyStats();
    } catch (err) {
      console.warn("[scriptz] daily stats load failed", err);
      return EMPTY;
    }
  },
  { initialValue: EMPTY },
);

export const dailyStatsStore = {
  /** Current statistics. Returns `EMPTY` while the first roundtrip
   *  is running - the UI just shows 0/0 instead of blocking. */
  stats,
  /** Manual trigger - e.g. after re-hydrate on app start. */
  refresh() {
    dailyStatsBus.bump();
  },
};
