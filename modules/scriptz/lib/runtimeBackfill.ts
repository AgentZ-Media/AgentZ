// Boot step for the stored runtime inputs (`dialog_word_count`,
// `direction_block_count`). Usually only never-measured scripts are
// filled in. When the formula in lib/runtime.ts counts differently, every
// script is recounted once so the library shows the same runtime as the
// editor without waiting for the next save. The app_state flag below
// marks the current formula as applied.

import type { KvStore } from "@agentz/kit/platform";
import { api } from "./api";

/** Set after the recount for the current formula (empty action blocks
 *  are no beat). */
export const RUNTIME_STATS_RECOUNT_FLAG = "migration.runtime_stats_v2";

export async function backfillRuntimeStatsOnBoot(kv: KvStore): Promise<void> {
  const recounted = await kv.getAppState(RUNTIME_STATS_RECOUNT_FLAG);
  await api.backfillRuntimeStats({ all: !recounted });
  if (!recounted) await kv.setAppState(RUNTIME_STATS_RECOUNT_FLAG, String(Date.now()));
}
