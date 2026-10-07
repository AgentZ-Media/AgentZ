import { t } from "../i18n";
import { compareVersions, getUpdatesStore, isNightlyVersion } from "../platform";
import { baseSettingsStore } from "../stores/baseSettings";
import { shellUi } from "../stores/ui";
import { account } from "./account";

// While the backend pauses this version's sync (account.syncBlock), dialog,
// banner and settings offer the same next step towards the update.

export interface SyncUpdateAction {
  label: string;
  /** Absent while something runs (download, check). */
  run?: () => void;
}

export interface SyncUpdateState {
  /** One sentence about the update, or null when the action says it all. */
  note: string | null;
  action: SyncUpdateAction | null;
}

/** Reactive: reads the updates store, the channel and the block. */
export function syncUpdateState(appName: string): SyncUpdateState {
  const store = getUpdatesStore();
  // Hosts without an updater (web) cannot help themselves.
  if (!store) return { note: t("account.update.manual", { appName }), action: null };
  const check = () => void store.checkNow();
  switch (store.stage()) {
    case "downloading":
      return { note: null, action: { label: t("account.update.downloading", { progress: store.progress() }) } };
    case "installing":
      return { note: null, action: { label: t("account.update.installing") } };
    case "ready":
      return { note: null, action: { label: t("account.update.restart"), run: () => void store.restart() } };
    case "available": {
      // The backend asks for a newer version than the one on offer.
      const block = account.syncBlock();
      const offered = store.available()?.version;
      if (block?.reason === "version" && block.minVersion && offered && (compareVersions(offered, block.minVersion) ?? 0) < 0) {
        return { note: t("account.update.notYet"), action: { label: t("account.update.checkAgain"), run: check } };
      }
      return {
        note: null,
        action: { label: t("account.update.install", { version: offered ?? "" }), run: () => void store.downloadAndInstall() },
      };
    }
    case "error":
      return { note: t("account.update.failed"), action: { label: t("account.update.retry"), run: () => void store.downloadAndInstall() } };
    case "idle":
      break;
  }
  switch (store.manualCheck()?.kind) {
    case "checking":
      return { note: null, action: { label: t("account.update.checking") } };
    case "error":
      return { note: t("account.update.checkFailed"), action: { label: t("account.update.checkAgain"), run: check } };
    case "uptodate": {
      // The data comes from a nightly and no stable release can read it yet.
      const block = account.syncBlock();
      const nightlyOnly = block?.reason === "format" && isNightlyVersion(block.by) && baseSettingsStore.updateChannel() === "stable";
      if (nightlyOnly) {
        return { note: t("account.update.nightlyOnly"), action: { label: t("account.update.openSettings"), run: () => shellUi.openSettings("updates") } };
      }
      return { note: t("account.update.notYet"), action: { label: t("account.update.checkAgain"), run: check } };
    }
    default:
      return { note: null, action: { label: t("account.update.check"), run: check } };
  }
}
