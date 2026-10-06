import { createVersionBus } from "./versionBus";

/** Version signal for the daily writing statistics (daily_word_log).
 *  Bumped as soon as `recordWordDelta` has written a positive increment -
 *  the stats store then invalidates and re-reads the
 *  heatmap data. */
export const dailyStatsBus = createVersionBus();
