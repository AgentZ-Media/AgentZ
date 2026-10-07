import { createSignal } from "solid-js";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { baseSettingsStore, pushToast } from "@agentz/kit/stores";
import { isNightlyVersion } from "@agentz/kit/platform";
import type { ManualCheckState, UpdateChannel, UpdatesStore, UpdateStage } from "@agentz/kit/platform";
import { flushAll, type FlushResult } from "@agentz/kit/lib";
import { t } from "@agentz/kit/i18n";

// The desktop updater. An update is downloaded (automatically, unless the
// user turned that off) and then waits in the native host until the app
// quits; the quit handshake installs it after everything is saved. Nothing
// ever restarts on its own: "Restart now" is always the user's choice.

const HOUR_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

/** A checked update; closing it frees the native resource. */
export interface CheckedUpdate {
  version: string;
  currentVersion: string;
  close(): Promise<void>;
}

/** The update the native host keeps for its installation. */
export interface StagedUpdate {
  version: string;
  currentVersion: string;
}

/** Native side (crates/agentz-desktop/src/updates.rs). */
export interface UpdateNative<U extends CheckedUpdate = CheckedUpdate> {
  check(channel: UpdateChannel): Promise<U | null>;
  /** Downloads and verifies the update, then stages it natively. */
  download(update: U, onEvent: (event: DownloadEvent) => void): Promise<StagedUpdate>;
  staged(): Promise<StagedUpdate | null>;
  discard(): Promise<void>;
  /** Installs the staged update now; Windows exits inside and restarts itself. */
  installNow(): Promise<void>;
  /** Installs (macOS) or prepares (Windows) the staged update for this quit. */
  installOnQuit(): Promise<boolean>;
}

export interface DesktopUpdatesOptions {
  /** Freeze user input before flushing; the returned function restores it. */
  lockEditing(): () => void;
  /** Native restart. Only called while editing is locked after a successful flush. */
  restart(): Promise<void>;
  /** Consistent copy of the app database. Runs after a successful flush and
   *  before a nightly update replaces the app (or a nightly build is replaced). */
  backupDatabase(label: string): Promise<void>;
}

interface UpdateDependencies<U extends CheckedUpdate> {
  native: UpdateNative<U>;
  flush(timeoutMs: number): Promise<FlushResult>;
  notifySaveFailure(): void;
  notifyUpdateFailure(): void;
  notifyBackupFailure(): void;
  isDevelopment: boolean;
  updateCheckEnabled(): boolean;
  hourlyUpdateCheck(): boolean;
  updateChannel(): UpdateChannel;
  /** Download found updates without asking; they install on quit. */
  autoInstall(): boolean;
}

type DesktopUpdate = Update;
type UpdateMetadata = ConstructorParameters<typeof Update>[0];

/** The native check knows both channel endpoints. On the nightly channel it
 * also considers the stable manifest, so a newer stable release always wins. */
const tauriNative: UpdateNative<DesktopUpdate> = {
  async check(channel) {
    const metadata = await invoke<UpdateMetadata | null>("plugin:agentz-desktop|update_check", { channel });
    return metadata ? new Update(metadata) : null;
  },
  download(update, onEvent) {
    const channel = new Channel<DownloadEvent>();
    channel.onmessage = onEvent;
    return invoke<StagedUpdate>("plugin:agentz-desktop|update_download", { rid: update.rid, onEvent: channel });
  },
  staged: () => invoke<StagedUpdate | null>("plugin:agentz-desktop|update_staged"),
  discard: () => invoke("plugin:agentz-desktop|update_discard"),
  installNow: () => invoke("plugin:agentz-desktop|update_install_now"),
  installOnQuit: () => invoke<boolean>("plugin:agentz-desktop|update_install_on_quit"),
};

/** Nightly builds share the stable database. Every switch into, within or out
 * of nightly builds gets a restorable copy first. */
export function updateNeedsBackup(update: Pick<StagedUpdate, "version" | "currentVersion">): boolean {
  return isNightlyVersion(update.version) || isNightlyVersion(update.currentVersion);
}

/** One updater per desktop boot. Importing this file starts no work. */
export function createDesktopUpdates<U extends CheckedUpdate = DesktopUpdate>(
  options: DesktopUpdatesOptions,
  overrides: Partial<UpdateDependencies<U>> = {},
) {
  const deps = {
    native: tauriNative as unknown as UpdateNative<U>,
    flush: flushAll,
    notifySaveFailure: () => pushToast(t("persistence.saveFailed"), "error"),
    notifyUpdateFailure: () => pushToast(t("shell.update.error"), "error"),
    notifyBackupFailure: () => pushToast(t("shell.update.backupFailed"), "error"),
    isDevelopment: import.meta.env.DEV,
    updateCheckEnabled: baseSettingsStore.updateCheckEnabled,
    hourlyUpdateCheck: baseSettingsStore.hourlyUpdateCheck,
    updateChannel: baseSettingsStore.updateChannel,
    autoInstall: baseSettingsStore.autoInstallUpdates,
    ...overrides,
  } satisfies UpdateDependencies<U>;
  const [stage, setStage] = createSignal<UpdateStage>("idle");
  const [available, setAvailable] = createSignal<{ version: string } | null>(null);
  const [progress, setProgress] = createSignal(0);
  const [manualCheck, setManualCheck] = createSignal<ManualCheckState | null>(null);
  let disposed = false;
  let checking = false;
  let downloading = false;
  let restarting = false;
  /** The installation ran; only the relaunch is left. */
  let installed = false;
  let backgroundStarted = false;
  let pollingEpoch = 0;
  let checked: U | null = null;
  /** The channel `checked` was found on. */
  let checkedChannel: UpdateChannel = "stable";
  let staged: (StagedUpdate & { channel: UpdateChannel }) | null = null;
  let unlock: (() => void) | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let hourlyTimer: ReturnType<typeof setInterval> | undefined;

  /** A natively staged update found without its check: a nightly belongs to that channel. */
  const channelOf = (update: StagedUpdate): UpdateChannel => isNightlyVersion(update.version) ? "nightly" : deps.updateChannel();
  const close = (update: U | null) => { void update?.close().catch(() => {}); };
  const release = () => { const current = unlock; unlock = undefined; current?.(); };

  /** What the UI shows when nothing runs. */
  function settle() {
    if (staged) { setAvailable({ version: staged.version }); setStage("ready"); }
    else if (checked) { setAvailable({ version: checked.version }); setStage("available"); }
    else { setAvailable(null); setStage("idle"); }
  }

  // A window reopened on macOS finds the update its predecessor downloaded.
  void deps.native.staged().then((found) => {
    if (disposed || !found || staged) return;
    staged = { ...found, channel: channelOf(found) };
    if (!downloading && !restarting) settle();
  }).catch(() => {});

  async function poll(manual: boolean): Promise<void> {
    if (disposed || checking || downloading || restarting || installed) return;
    if (!manual && !deps.updateCheckEnabled()) return;
    const epoch = pollingEpoch;
    const channel = deps.updateChannel();
    let autoDownload = false;
    checking = true;
    if (manual) setManualCheck({ kind: "checking" });
    try {
      // An update found or staged for the channel the user just left is never installed.
      if (checked && checkedChannel !== channel) {
        close(checked);
        checked = null;
        settle();
      }
      if (staged && staged.channel !== channel) {
        await deps.native.discard();
        staged = null;
        settle();
      }
      const update = await deps.native.check(channel);
      // A result for a channel the user just left is never offered.
      if (disposed || channel !== deps.updateChannel()
        || (!manual && (epoch !== pollingEpoch || !deps.updateCheckEnabled()))) {
        close(update);
        if (!disposed && manual) setManualCheck(null);
        return;
      }
      close(checked);
      checked = null;
      if (update && staged && update.version === staged.version) {
        // Already downloaded; it installs on quit.
        close(update);
      } else {
        checked = update;
        checkedChannel = channel;
      }
      settle();
      if (manual) setManualCheck(checked || staged ? null : { kind: "uptodate" });
      autoDownload = !!checked && deps.autoInstall();
    } catch {
      if (!disposed && manual) setManualCheck({ kind: "error" });
    } finally {
      checking = false;
    }
    if (autoDownload) void download(false);
  }

  /** Downloads the checked update and stages it for the next quit. */
  async function download(userInitiated = true): Promise<void> {
    const update = checked;
    if (disposed || !update || checking || downloading || restarting || installed) return;
    // An update belongs to the channel it was checked for.
    const channel = checkedChannel;
    if (channel !== deps.updateChannel()) {
      close(update);
      checked = null;
      settle();
      return;
    }
    downloading = true;
    setManualCheck(null);
    setStage("downloading");
    setProgress(0);
    let total = 0;
    let received = 0;
    try {
      const result = await deps.native.download(update, (event) => {
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
      if (disposed) return;
      if (checked === update) { close(checked); checked = null; }
      if (channel !== deps.updateChannel()) {
        // The user switched channels meanwhile: never install this one. The
        // native host held only this download, an earlier one is gone too.
        await deps.native.discard();
        staged = null;
        settle();
        return;
      }
      staged = { ...result, channel };
      settle();
    } catch (error) {
      if (disposed) return;
      console.warn("[desktop] update download failed", error);
      // A background download simply tries again with the next check.
      if (userInitiated) {
        setStage("error");
        deps.notifyUpdateFailure();
      } else settle();
    } finally {
      downloading = false;
      if (disposed) close(update);
    }
  }

  /** "Restart now": save, back up if needed, install and relaunch. */
  async function restart(): Promise<void> {
    if (disposed || restarting || downloading || checking) return;
    if (!staged && !installed) {
      // Error after a failed download: the button retries the download.
      if (checked) await download(true);
      return;
    }
    if (!installed && staged && staged.channel !== deps.updateChannel()) {
      await deps.native.discard().catch(() => {});
      staged = null;
      settle();
      return;
    }
    restarting = true;
    setManualCheck(null);
    try {
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
      if (!installed && staged && updateNeedsBackup(staged)) {
        try {
          await options.backupDatabase(`before-${staged.version}`);
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
        // Windows exits inside the installation. The successful flush MUST
        // precede this call: https://v2.tauri.app/plugin/updater/#checking-for-updates
        await deps.native.installNow();
        installed = true;
        staged = null;
      }
      if (disposed) return;
      await options.restart();
      // Keep input frozen until the successful native restart ends this app.
    } catch {
      if (!disposed) {
        setStage("error");
        deps.notifyUpdateFailure();
      }
      release();
    } finally {
      restarting = false;
      if (disposed) release();
    }
  }

  /**
   * Called by the quit handshake after everything was saved. Installs the
   * downloaded update so the next start runs it. Never throws: a failure
   * leaves the app as it is and the update is downloaded again later.
   */
  async function prepareExit(): Promise<void> {
    if (disposed || restarting || installed) return;
    try {
      // A download a closed window started may have finished since.
      if (!staged) {
        const found = await deps.native.staged();
        if (found) staged = { ...found, channel: channelOf(found) };
      }
      if (!staged) return;
      if (staged.channel !== deps.updateChannel()) {
        await deps.native.discard();
        staged = null;
        return;
      }
      if (updateNeedsBackup(staged)) await options.backupDatabase(`before-${staged.version}`);
      if (await deps.native.installOnQuit()) installed = true;
    } catch (error) {
      console.warn("[desktop] installing the update on quit failed", error);
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
    download: () => download(true),
    restart,
    clearManualCheck: () => setManualCheck(null),
    startBackgroundPolling,
    stopBackgroundPolling,
  };
  return {
    store,
    prepareExit,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopBackgroundPolling();
      release();
      // A running native download still owns the checked resource; the
      // native host keeps a staged update for a reopened window.
      if (!downloading) close(checked);
      checked = null;
    },
  };
}
