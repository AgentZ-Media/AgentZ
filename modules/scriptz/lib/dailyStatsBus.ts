import { createSignal } from "solid-js";

/** Version signal for the daily writing statistics (daily_word_log).
 *  Bumped as soon as `recordWordDelta` has written a positive increment -
 *  the stats store then invalidates and re-reads the
 *  heatmap/streak data. */
const [version, setVersion] = createSignal(0);

export const dailyStatsBus = {
  version,
  bump() {
    // Functional updater instead of `setVersion(version() + 1)`. Otherwise
    // `version()` would attach the caller's subscription (e.g. a
    // createEffect that calls `dailyStatsBus.bump()`) to the
    // version signal itself - and the immediately following
    // `setVersion` would trigger the same subscription again → hard
    // infinite recursion via `markDownstream`.
    setVersion((v) => v + 1);
  },
};
