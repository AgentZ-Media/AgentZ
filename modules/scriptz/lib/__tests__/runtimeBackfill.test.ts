// The one-time recount after a formula change is only marked as done when
// every row was written; a failed row is retried on the next boot.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KvStore } from "@agentz/kit/platform";
import { getStorageAdapter, setStorageAdapter } from "../storage";
import { RUNTIME_STATS_RECOUNT_FLAG, backfillRuntimeStatsOnBoot } from "../runtimeBackfill";

const originalAdapter = getStorageAdapter();
afterEach(() => setStorageAdapter(originalAdapter));

function memoryKv(): KvStore & { state: Map<string, string> } {
  const state = new Map<string, string>();
  return {
    state,
    getAppState: async (key) => state.get(key) ?? null,
    setAppState: async (key, value) => void state.set(key, value),
    getSetting: async () => null,
    setSetting: async () => {},
  };
}

function withBackfill(results: boolean[]) {
  const backfill = vi.fn(async () => results.shift() ?? true);
  setStorageAdapter({ ...originalAdapter, backfillRuntimeStats: backfill });
  return backfill;
}

describe("runtime stats recount on boot", () => {
  it("keeps recounting every script until a pass writes every row", async () => {
    const kv = memoryKv();
    const backfill = withBackfill([false, true, true]);

    await backfillRuntimeStatsOnBoot(kv);
    expect(backfill).toHaveBeenLastCalledWith({ all: true });
    expect(kv.state.has(RUNTIME_STATS_RECOUNT_FLAG)).toBe(false);

    await backfillRuntimeStatsOnBoot(kv);
    expect(backfill).toHaveBeenLastCalledWith({ all: true });
    expect(kv.state.has(RUNTIME_STATS_RECOUNT_FLAG)).toBe(true);

    await backfillRuntimeStatsOnBoot(kv);
    expect(backfill).toHaveBeenLastCalledWith({ all: false });
  });
});
