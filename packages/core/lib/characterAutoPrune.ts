// Optional automatic registry cleanup ("only keep names that are used").
//
// When the setting is on, every write that may have dropped a character
// name (adapters ping `characterUsageBus.notifyNamesDropped`) re-arms a
// debounce timer; once the writer pauses, one prune pass runs in the
// background. The debounce also swallows the burst of intermediate names
// a save while typing produces ("B", "BO", "BOB"). Passes are serialized
// so two scans never run at the same time.

import { api } from "./api";
import { characterUsageBus } from "./characterUsage";

/** Quiet period after the last drop signal before a pass runs. */
export const AUTO_PRUNE_DEBOUNCE_MS = 4000;
/** Delay of the catch-up pass after boot (removals from a previous session
 *  whose pass never ran), so it never competes with the first paint. */
export const AUTO_PRUNE_BOOT_DELAY_MS = 10_000;

let isEnabled: () => boolean = () => false;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** (Re)arms the timer for one background pass. */
export function scheduleCharacterPrune(delayMs = AUTO_PRUNE_DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    runCharacterPrune().catch((err) => {
      console.warn("[scriptz] automatic character cleanup failed", err);
    });
  }, delayMs);
}

/** Runs one pass now, queued behind a pass still in flight. Resolves with
 *  the deleted names; no-op (empty list) while the setting is off. */
export function runCharacterPrune(): Promise<string[]> {
  const pass = chain
    .catch(() => {})
    .then(() => (isEnabled() ? api.pruneUnusedCharacterNames() : []));
  chain = pass;
  return pass;
}

/** Wires the cleanup to the drop signal. `enabled` is read on every pass,
 *  so toggling the setting takes effect immediately. Returns a stop
 *  function (cancels a pending pass). */
export function startCharacterAutoPrune(enabled: () => boolean): () => void {
  isEnabled = enabled;
  const off = characterUsageBus.onNamesDropped(() => {
    if (isEnabled()) scheduleCharacterPrune();
  });
  if (isEnabled()) scheduleCharacterPrune(AUTO_PRUNE_BOOT_DELAY_MS);
  return () => {
    off();
    if (timer) clearTimeout(timer);
    timer = null;
    isEnabled = () => false;
  };
}
