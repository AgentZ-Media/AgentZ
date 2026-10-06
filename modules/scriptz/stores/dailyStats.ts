import { createEffect, createResource, createRoot, createSignal, on, onCleanup, type Resource } from "solid-js";
import { debounce } from "@agentz/kit/lib";
import { api } from "../lib/api";
import { dailyStatsBus } from "../lib/dailyStatsBus";
import type { DailyStatsSummary } from "../lib/types";

// The heatmap expects dailyWords with a fixed length of 365
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

// Stable accessors stay empty until boot explicitly starts this shared cache.
const [resource, setResource] = createSignal<Resource<DailyStatsSummary>>();
const stats = () => resource()?.() ?? EMPTY;
/** Nearly every autosave books words: reload once typing pauses, not after
 *  each save (365 days per load). */
const RELOAD_DEBOUNCE_MS = 1500;
let stopRuntime: (() => void) | undefined;

export function startDailyStatsStore(): () => void {
  if (stopRuntime) return stopRuntime;
  let active = true;
  const disposeRoot = createRoot((dispose) => {
    const [reload, setReload] = createSignal(0);
    const bump = debounce(() => setReload((n) => n + 1), RELOAD_DEBOUNCE_MS);
    createEffect(on(dailyStatsBus.version, () => bump(), { defer: true }));
    onCleanup(() => bump.cancel());
    const [value] = createResource(
      reload,
      async () => {
        try {
          const result = await api.loadDailyStats();
          return active ? result : EMPTY;
        } catch (err) {
          if (active) console.warn("[scriptz] daily stats load failed", err);
          return EMPTY as DailyStatsSummary;
        }
      },
      { initialValue: EMPTY as DailyStatsSummary },
    );
    setResource(() => value);
    return dispose;
  });
  const stop = () => {
    if (!active) return;
    active = false;
    disposeRoot();
    setResource(undefined);
    stopRuntime = undefined;
  };
  stopRuntime = stop;
  return stop;
}

export const dailyStatsStore = {
  /** Current statistics. Returns `EMPTY` while the first roundtrip
   *  is running - the UI just shows 0/0 instead of blocking. */
  stats,
};
