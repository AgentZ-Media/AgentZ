import type { KvStore } from "../platform";

/** Persist the product's established once marker, then close its onboarding.
 * Completion remains non-blocking when storage is temporarily unavailable. */
export async function completeOnboarding(kv: KvStore, key: string, close: () => void, signal?: AbortSignal) {
  if (signal?.aborted) return;
  try { await kv.setAppState(key, "1"); } catch { /* non-blocking */ }
  if (!signal?.aborted) close();
}
