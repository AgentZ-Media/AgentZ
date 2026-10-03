import { createSignal } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { baseSettingsStore, pushToast } from "@agentz/kit/stores";
import type { ManualCheckState, UpdatesStore, UpdateStage } from "@agentz/kit/platform";
import { flushAll, type FlushResult } from "@agentz/kit/lib";
import { t } from "@agentz/kit/i18n";

const HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

type DesktopUpdate = Pick<Update, "version" | "download" | "install" | "close">;
export interface DesktopUpdatesOptions {
  /** Freeze user input before flushing; the returned function restores it. */
  lockEditing(): () => void;
  /** Native restart. Only called while editing is locked after a successful flush. */
  restart(): Promise<void>;
}

interface UpdateDependencies {
  check(): Promise<DesktopUpdate | null>;
  flush(timeoutMs: number): Promise<FlushResult>;
  notifySaveFailure(): void;
  notifyUpdateFailure(): void;
  isDevelopment: boolean;
  updateCheckEnabled(): boolean;
  hourlyUpdateCheck(): boolean;
}

/** One updater per desktop boot. Importing this file starts no work. */
export function createDesktopUpdates(options: DesktopUpdatesOptions, overrides: Partial<UpdateDependencies> = {}) {
  const deps: UpdateDependencies = {
    check,
    flush: flushAll,
    notifySaveFailure: () => pushToast(t("persistence.saveFailed"), "error"),
    notifyUpdateFailure: () => pushToast(t("shell.update.error"), "error"),
    isDevelopment: import.meta.env.DEV,
    updateCheckEnabled: baseSettingsStore.updateCheckEnabled,
    hourlyUpdateCheck: baseSettingsStore.hourlyUpdateCheck,
    ...overrides,
  };
  const [stage, setStage] = createSignal<UpdateStage>("idle");
  const [available, setAvailable] = createSignal<DesktopUpdate | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [manualCheck, setManualCheck] = createSignal<ManualCheckState | null>(null);
  let disposed = false;
  let checking = false;
  let applying = false;
  let downloaded = false;
  let installed = false;
  let restarting = false;
  let backgroundStarted = false;
  let pollingEpoch = 0;
  let unlock: (() => void) | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let hourlyTimer: ReturnType<typeof setInterval> | undefined;

  const close = (update: DesktopUpdate | null) => { void update?.close().catch(() => {}); };
  const release = () => { const current = unlock; unlock = undefined; current?.(); };

  async function poll(manual: boolean): Promise<void> {
    if (disposed || checking || applying || installed) return;
    if (!manual && !deps.updateCheckEnabled()) return;
    const epoch = pollingEpoch;
    checking = true;
    if (manual) setManualCheck({ kind: "checking" });
    try {
      const update = await deps.check();
      if (disposed || (!manual && (epoch !== pollingEpoch || !deps.updateCheckEnabled()))) {
        close(update);
        return;
      }
      close(available());
      downloaded = false;
      setAvailable(update);
      setStage(update ? "available" : "idle");
      if (manual) setManualCheck(update ? null : { kind: "uptodate" });
    } catch {
      if (!disposed && manual) setManualCheck({ kind: "error" });
    } finally {
      checking = false;
    }
  }

  async function applyUpdate(): Promise<void> {
    const update = available();
    if (disposed || !update || applying || checking || restarting) return;
    applying = true;
    setManualCheck(null);
    try {
      if (!downloaded && !installed) {
        setStage("downloading");
        setProgress(0);
        let total = 0;
        let received = 0;
        await update.download((event) => {
          if (disposed) return;
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
            received = 0;
            setProgress(0);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            if (total > 0) setProgress(Math.min(99, Math.floor(received / total * 100)));
          } else if (event.event === "Finished") setProgress(100);
        });
        downloaded = true;
      }
      if (disposed) return;
      unlock = options.lockEditing();
      setStage("installing");
      const flushed = await deps.flush(2000);
      if (disposed) return;
      if (!flushed.ok) {
        setStage("error");
        deps.notifySaveFailure();
        release();
        return;
      }
      if (!installed) {
        // Windows can exit inside install(). The successful flush MUST precede
        // this call: https://v2.tauri.app/plugin/updater/#checking-for-updates
        // An install attempt consumes native bytes even if it fails; download
        // again on that retry. A failed flush retains the existing download.
        downloaded = false;
        await update.install();
        installed = true;
      }
      if (disposed) return;
      setStage("ready");
      await options.restart();
      restarting = true;
      // Keep input frozen until the successful native restart ends this app.
    } catch {
      if (!disposed) {
        setStage("error");
        deps.notifyUpdateFailure();
      }
      release();
    } finally {
      applying = false;
      if (disposed) { release(); close(update); }
    }
  }

  function stopBackgroundPolling(): void {
    backgroundStarted = false;
    pollingEpoch++;
    clearTimeout(startupTimer);
    clearInterval(hourlyTimer);
    startupTimer = undefined;
    hourlyTimer = undefined;
  }

  function startBackgroundPolling(): void {
    if (disposed || backgroundStarted || deps.isDevelopment || !deps.updateCheckEnabled()) return;
    backgroundStarted = true;
    startupTimer = setTimeout(() => { void poll(false); }, STARTUP_DELAY_MS);
    if (deps.hourlyUpdateCheck()) {
      hourlyTimer = setInterval(() => { if (deps.hourlyUpdateCheck()) void poll(false); }, HOUR_MS);
    }
  }

  const store: UpdatesStore = {
    stage, available, progress, manualCheck,
    checkNow: () => poll(true),
    downloadAndInstall: applyUpdate,
    restart: applyUpdate,
    clearManualCheck: () => setManualCheck(null),
    startBackgroundPolling,
    stopBackgroundPolling,
  };
  return {
    store,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopBackgroundPolling();
      release();
      // An active native download/install still owns this resource. Its
      // continuation closes it after settling, without installing/restarting.
      if (!applying) close(available());
    },
  };
}
