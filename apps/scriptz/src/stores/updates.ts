import { createSignal } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { settingsStore } from "@agentz/scriptz/stores/settings";
import { setUpdatesStore, type UpdatesStore } from "@agentz/scriptz/lib/updates";
import { flushAll } from "@agentz/scriptz/lib/saveFlush";

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

const HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

const [stage, setStage] = createSignal<UpdateStage>("idle");
const [available, setAvailable] = createSignal<Update | null>(null);
const [progress, setProgress] = createSignal(0);
// Surfaces "checking" / "uptodate" / "error" feedback to the Settings
// dialog. The pill never reads this — it only shows when an update is
// actually live in `stage`.
const [manualCheck, setManualCheck] = createSignal<ManualCheckState | null>(null);

let inFlight = false;
let backgroundStarted = false;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let hourlyTimer: ReturnType<typeof setInterval> | null = null;

async function poll(opts: { manual: boolean }): Promise<void> {
  if (inFlight) return;
  const s = stage();
  if (s === "downloading" || s === "ready") return;
  inFlight = true;
  if (opts.manual) setManualCheck({ kind: "checking" });
  try {
    const update = await check();
    if (update) {
      setAvailable(update);
      setStage("available");
      if (opts.manual) setManualCheck(null);
    } else if (opts.manual) {
      setManualCheck({ kind: "uptodate" });
    }
  } catch {
    if (opts.manual) setManualCheck({ kind: "error" });
    /* background poll: stay silent (offline, etc.) */
  } finally {
    inFlight = false;
  }
}

async function downloadAndInstall(): Promise<void> {
  const update = available();
  if (!update) return;
  if (stage() === "downloading" || stage() === "ready") return;

  setStage("downloading");
  setProgress(0);
  let total = 0;
  let got = 0;
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          total = event.data.contentLength ?? 0;
          got = 0;
          setProgress(0);
          break;
        case "Progress":
          got += event.data.chunkLength;
          if (total > 0) {
            setProgress(Math.min(99, Math.floor((got / total) * 100)));
          }
          break;
        case "Finished":
          setProgress(100);
          break;
      }
    });
    setStage("ready");
  } catch {
    setStage("error");
    setTimeout(() => {
      if (stage() === "error") setStage("available");
    }, 4000);
  }
}

async function restart(): Promise<void> {
  try {
    // Drain pending writes (debounced auto-save, tab-state) before
    // the relaunch tears the process down. Without this, the last
    // ~250 ms of typing can be lost if the user clicks the update
    // pill mid-edit. The window-close handler in App.tsx doesn't run
    // here because `relaunch` restarts the process directly.
    await flushAll(2000);
  } catch (err) {
    console.warn("[scriptz] flushAll before relaunch failed", err);
  }
  try {
    await relaunch();
  } catch {
    setStage("error");
  }
}

function startBackgroundPolling(): void {
  if (backgroundStarted) return;
  if (import.meta.env.DEV) return;
  if (!settingsStore.updateCheckEnabled()) return;
  backgroundStarted = true;
  startupTimer = setTimeout(() => {
    void poll({ manual: false });
  }, STARTUP_DELAY_MS);
  if (settingsStore.hourlyUpdateCheck()) {
    hourlyTimer = setInterval(() => {
      void poll({ manual: false });
    }, HOUR_MS);
  }
}

function stopBackgroundPolling(): void {
  backgroundStarted = false;
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (hourlyTimer) {
    clearInterval(hourlyTimer);
    hourlyTimer = null;
  }
}

export const updatesStore: UpdatesStore = {
  stage,
  available,
  progress,
  manualCheck,
  checkNow: () => poll({ manual: true }),
  downloadAndInstall,
  restart,
  clearManualCheck: () => setManualCheck(null),
  startBackgroundPolling,
  stopBackgroundPolling,
};

// Register with @agentz/scriptz so SettingsDialog can pick it up.
setUpdatesStore(updatesStore);
