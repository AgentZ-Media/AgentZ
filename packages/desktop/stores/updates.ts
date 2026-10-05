import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import { baseSettingsStore, pushToast } from "@agentz/kit/stores";
import { isNightlyVersion } from "@agentz/kit/platform";
import type { ManualCheckState, UpdateChannel, UpdatesStore, UpdateStage } from "@agentz/kit/platform";
import { flushAll, type FlushResult } from "@agentz/kit/lib";
import { t } from "@agentz/kit/i18n";

const HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

type DesktopUpdate = Pick<Update, "version" | "currentVersion" | "download" | "install" | "close">;
type UpdateMetadata = ConstructorParameters<typeof Update>[0];
export interface DesktopUpdatesOptions {
  /** Freeze user input before flushing; the returned function restores it. */
  lockEditing(): () => void;
  /** Native restart. Only called while editing is locked after a successful flush. */
  restart(): Promise<void>;
  /** Consistent copy of the app database. Runs after a successful flush and
   *  before a nightly update replaces the app (or a nightly build is replaced). */
  backupDatabase(label: string): Promise<void>;
}

interface UpdateDependencies {
  check(channel: UpdateChannel): Promise<DesktopUpdate | null>;
  flush(timeoutMs: number): Promise<FlushResult>;
  notifySaveFailure(): void;
  notifyUpdateFailure(): void;
  notifyBackupFailure(): void;
  isDevelopment: boolean;
  updateCheckEnabled(): boolean;
  hourlyUpdateCheck(): boolean;
  updateChannel(): UpdateChannel;
}

/** The native check knows both channel endpoints. On the nightly channel it
 * also considers the stable manifest, so a newer stable release always wins. */
async function checkChannel(channel: UpdateChannel): Promise<DesktopUpdate | null> {
  const metadata = await invoke<UpdateMetadata | null>("plugin:agentz-desktop|update_check", { channel });
  return metadata ? new Update(metadata) : null;
}

/** Nightly builds share the stable database. Every switch into, within or out
 * of nightly builds gets a restorable copy first. */
export function updateNeedsBackup(update: Pick<DesktopUpdate, "version" | "currentVersion">): boolean {
  return isNightlyVersion(update.version) || isNightlyVersion(update.currentVersion);
}

/** One updater per desktop boot. Importing this file starts no work. */
export function createDesktopUpdates(options: DesktopUpdatesOptions, overrides: Partial<UpdateDependencies> = {}) {
  const deps: UpdateDependencies = {
    check: checkChannel,
    flush: flushAll,
    notifySaveFailure: () => pushToast(t("persistence.saveFailed"), "error"),
    notifyUpdateFailure: () => pushToast(t("shell.update.error"), "error"),
    notifyBackupFailure: () => pushToast(t("shell.update.backupFailed"), "error"),
    isDevelopment: import.meta.env.DEV,
    updateCheckEnabled: baseSettingsStore.updateCheckEnabled,
    hourlyUpdateCheck: baseSettingsStore.hourlyUpdateCheck,
    updateChannel: baseSettingsStore.updateChannel,
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
    const channel = deps.updateChannel();
    checking = true;
    if (manual) setManualCheck({ kind: "checking" });
    try {
      const update = await deps.check(channel);
      // A result for a channel the user just left is never offered.
      if (disposed || channel !== deps.updateChannel()
        || (!manual && (epoch !== pollingEpoch || !deps.updateCheckEnabled()))) {
        close(update);
        if (!disposed && manual) setManualCheck(null);
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
      if (!installed && updateNeedsBackup(update)) {
        try {
          await options.backupDatabase(`before-${update.version}`);
        } catch (error) {
          console.warn("[desktop] database backup before update failed", error);
          if (disposed) return;
          // Keep the download: a retry saves and backs up again, then installs.
          setStage("error");
          deps.notifyBackupFailure();
          release();
          return;
        }
        if (disposed) return;
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
