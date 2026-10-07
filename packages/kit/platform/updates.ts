// Optional auto-update service registered explicitly by the host.
// Shared UI hides updater controls when the host leaves this slot empty.

import type { Accessor } from "solid-js";

/**
 * - available: found, not downloaded yet
 * - ready: downloaded; installs when the app quits, or now with `restart()`
 * - installing: saving, backing up and installing for a restart
 */
export type UpdateStage =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export type ManualCheckState =
  | { kind: "checking" }
  | { kind: "uptodate" }
  | { kind: "error" };

export interface AvailableUpdate {
  /** Human-readable version of the update, e.g. "0.7.4". */
  version: string;
}

export interface UpdatesStore {
  stage: Accessor<UpdateStage>;
  available: Accessor<AvailableUpdate | null>;
  progress: Accessor<number>;
  manualCheck: Accessor<ManualCheckState | null>;
  checkNow(): Promise<void>;
  /** Downloads the available update; it installs on quit. */
  download(): Promise<void>;
  /** Saves, installs the downloaded update and restarts. Only on request. */
  restart(): Promise<void>;
  clearManualCheck(): void;
  startBackgroundPolling(): void;
  stopBackgroundPolling(): void;
}

let store: UpdatesStore | null = null;

/** Register the host's updates implementation. Called once at app
 * startup. Hosts without an updater leave this slot unregistered. */
export function setUpdatesStore(s: UpdatesStore): void {
  store = s;
}

/** Returns the registered updates store, or null if the host doesn't
 * support auto-updates. UI code must handle the null case. */
export function getUpdatesStore(): UpdatesStore | null {
  return store;
}
