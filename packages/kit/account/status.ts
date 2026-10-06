import { t } from "../i18n";
import { relativeTime } from "../lib";
import { account } from "./account";

export type SyncTone = "ok" | "busy" | "warn" | "off";

/** One line about the sync for chip, menu and settings. */
export function syncStatus(): { text: string; tone: SyncTone } {
  if (!account.signedIn()) return { text: t("account.signInHint"), tone: "off" };
  if (!account.syncAvailable()) return { text: t("account.status.localOnly"), tone: "off" };
  switch (account.keyPhase()) {
    case "none":
    case "checking": return { text: t("account.status.checking"), tone: "busy" };
    case "enter": return { text: t("account.status.locked"), tone: "warn" };
    case "create": return { text: t("account.status.setup"), tone: "warn" };
    case "resetting": return { text: t("account.status.resetting"), tone: "busy" };
    case "ready": break;
  }
  switch (account.syncPhase()) {
    case "syncing": return { text: t("account.status.syncing"), tone: "busy" };
    case "offline": return { text: t("account.status.offline"), tone: "warn" };
    case "error": return { text: t("account.status.error"), tone: "warn" };
    case "idle": {
      const at = account.lastSyncedAt();
      return at ? { text: t("account.status.synced", { time: relativeTime(at) }), tone: "ok" } : { text: t("account.status.never"), tone: "busy" };
    }
  }
}
