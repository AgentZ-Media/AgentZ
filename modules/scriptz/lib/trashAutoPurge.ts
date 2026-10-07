// Automatic trash cleanup: scripts that sat in the trash for
// TRASH_RETENTION_DAYS are deleted for good. One pass runs shortly after
// boot and then every hour, because the app may stay open for days. The
// deletes go through the change feed like a manual purge, so a signed-in
// device also removes the cloud copies.

import { api } from "./api";
import { scriptsBus } from "./scriptsBus";

export const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;
/** Delay of the first pass, so it never competes with the first paint. */
export const TRASH_PURGE_BOOT_DELAY_MS = 15_000;
export const TRASH_PURGE_INTERVAL_MS = 60 * 60 * 1000;

/** Whole days (at least 1) until a script trashed at `archivedAt` is
 *  deleted automatically. */
export function daysUntilPurge(archivedAt: number, now: number): number {
  return Math.max(1, Math.ceil((archivedAt + TRASH_RETENTION_MS - now) / DAY_MS));
}

/** Deletes every expired trash entry now; returns how many went. */
export async function runTrashPurge(now: number = Date.now()): Promise<number> {
  const purged = await api.purgeExpiredTrash(now - TRASH_RETENTION_MS);
  if (purged > 0) scriptsBus.bump();
  return purged;
}

/** Starts the background passes. Returns a stop function; a pass still in
 *  flight finishes, but no new one starts. */
export function startTrashAutoPurge(): () => void {
  let stopped = false;
  let running = false;
  const pass = () => {
    if (stopped || running) return;
    running = true;
    runTrashPurge()
      .catch((err) => console.warn("[scriptz] automatic trash cleanup failed", err))
      .finally(() => {
        running = false;
      });
  };
  const boot = setTimeout(pass, TRASH_PURGE_BOOT_DELAY_MS);
  const interval = setInterval(pass, TRASH_PURGE_INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(boot);
    clearInterval(interval);
  };
}
