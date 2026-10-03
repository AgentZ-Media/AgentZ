// Auto-update service slot for @agentz/scriptz.
//
// The actual updater lives in the host app (Tauri's plugin-updater).
// UI in core (SettingsDialog) queries this
// slot - if a store is registered, the "Updates" section renders;
// otherwise it stays hidden.
//
// The Solid accessor shapes mirror what apps/scriptz/src/stores/updates.ts
// exposes, so the desktop store can be registered directly without a
// wrapper.

import type { Accessor } from "solid-js";

export type UpdateStage =
  | "idle"
  | "available"
  | "downloading"
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
  downloadAndInstall(): Promise<void>;
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
