import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "@agentz/kit/platform";
import { createDesktopUpdates, updateNeedsBackup } from "../updates";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup({ version = "1.0.1", currentVersion = "1.0.0" } = {}) {
  const sequence: string[] = [];
  let channel: UpdateChannel = "stable";
  const update = {
    version,
    currentVersion,
    download: vi.fn(async (_event?: (event: DownloadEvent) => void) => { sequence.push("download"); }),
    install: vi.fn(async () => { sequence.push("install"); }),
    close: vi.fn(async () => {}),
  };
  const unlock = vi.fn(() => { sequence.push("unlock"); });
  const options = {
    lockEditing: vi.fn(() => { sequence.push("lock"); return unlock; }),
    restart: vi.fn(async () => { sequence.push("restart"); }),
    backupDatabase: vi.fn(async (_label: string) => { sequence.push("backup"); }),
  };
  const deps = {
    check: vi.fn(async (_channel: UpdateChannel) => update),
    flush: vi.fn(async () => { sequence.push("flush"); return { ok: true, failed: [] as string[], contentFailed: [] as string[] }; }),
    notifySaveFailure: vi.fn(), notifyUpdateFailure: vi.fn(), notifyBackupFailure: vi.fn(),
    isDevelopment: false,
    updateCheckEnabled: () => true,
    hourlyUpdateCheck: () => true,
    updateChannel: () => channel,
  };
  const runtime = createDesktopUpdates(options, deps);
  const setChannel = (next: UpdateChannel) => { channel = next; };
  return { ...runtime, sequence, update, unlock, options, deps, setChannel };
}
afterEach(() => vi.useRealTimers());

describe("desktop updater safety", () => {
  it("downloads before locking, saves before installing, and stays frozen through restart", async () => {
    const s = setup();
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.sequence).toEqual(["download", "lock", "flush", "install", "restart"]);
    expect(s.store.stage()).toBe("ready");
    expect(s.unlock).not.toHaveBeenCalled();
    await s.store.restart();
    expect(s.options.restart).toHaveBeenCalledOnce();
    s.dispose();
    expect(s.unlock).toHaveBeenCalledOnce();
  });

  it("aborts on failed flush, unlocks, and retries saving the existing download", async () => {
    const s = setup();
    s.deps.flush.mockImplementationOnce(async () => { s.sequence.push("flush"); return { ok: false, failed: ["editor"], contentFailed: ["editor"] }; });
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.sequence).toEqual(["download", "lock", "flush", "unlock"]);
    expect(s.update.install).not.toHaveBeenCalled();
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.deps.notifySaveFailure).toHaveBeenCalledOnce();
    expect(s.store.stage()).toBe("error");
    await s.store.downloadAndInstall();
    expect(s.update.download).toHaveBeenCalledOnce();
    expect(s.sequence.slice(4)).toEqual(["lock", "flush", "install", "restart"]);
    s.dispose();
  });

  it("does not flush or install when close or quit already owns the editing lock", async () => {
    const s = setup();
    s.options.lockEditing.mockImplementationOnce(() => { throw new Error("lifecycle busy"); });
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.deps.flush).not.toHaveBeenCalled();
    expect(s.update.install).not.toHaveBeenCalled();
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.unlock).not.toHaveBeenCalled();
    expect(s.store.stage()).toBe("error");
    s.dispose();
  });

  it("cannot install a failed download and never locks editing for it", async () => {
    const s = setup();
    s.update.download.mockRejectedValueOnce(new Error("network unavailable"));
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.options.lockEditing).not.toHaveBeenCalled();
    expect(s.update.install).not.toHaveBeenCalled();
    expect(s.store.stage()).toBe("error");
    expect(s.deps.notifyUpdateFailure).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("unlocks after failed installation and downloads new native bytes before retry", async () => {
    const s = setup();
    s.update.install.mockRejectedValueOnce(new Error("installer failed"));
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.store.stage()).toBe("error");
    expect(s.unlock).toHaveBeenCalledOnce();
    expect(s.options.restart).not.toHaveBeenCalled();
    await s.store.downloadAndInstall();
    expect(s.update.download).toHaveBeenCalledTimes(2);
    expect(s.update.install).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("after a failed restart saves again but never reinstalls an already installed update", async () => {
    const s = setup();
    s.options.restart.mockRejectedValueOnce(new Error("restart failed"));
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.store.stage()).toBe("error");
    expect(s.unlock).toHaveBeenCalledOnce();
    await s.store.checkNow();
    expect(s.deps.check).toHaveBeenCalledOnce();
    await s.store.restart();
    expect(s.update.install).toHaveBeenCalledOnce();
    expect(s.deps.flush).toHaveBeenCalledTimes(2);
    expect(s.options.restart).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("never locks, installs or restarts a download that settles after disposal", async () => {
    const s = setup();
    const pending = deferred<void>();
    s.update.download.mockReturnValueOnce(pending.promise);
    await s.store.checkNow();
    const applying = s.store.downloadAndInstall();
    s.dispose();
    pending.resolve();
    await applying;
    expect(s.options.lockEditing).not.toHaveBeenCalled();
    expect(s.update.install).not.toHaveBeenCalled();
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.update.close).toHaveBeenCalledOnce();
  });

  it("does not restart when disposed during native installation", async () => {
    const s = setup();
    const pending = deferred<void>();
    s.update.install.mockReturnValueOnce(pending.promise);
    await s.store.checkNow();
    const applying = s.store.downloadAndInstall();
    await vi.waitFor(() => expect(s.update.install).toHaveBeenCalledOnce());
    s.dispose();
    pending.resolve();
    await applying;
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.unlock).toHaveBeenCalledOnce();
  });

  it("serializes duplicate install clicks and ignores checks during download", async () => {
    const s = setup();
    const pending = deferred<void>();
    s.update.download.mockReturnValueOnce(pending.promise);
    await s.store.checkNow();
    const applying = s.store.downloadAndInstall();
    await s.store.downloadAndInstall();
    await s.store.checkNow();
    pending.resolve();
    await applying;
    expect(s.update.download).toHaveBeenCalledOnce();
    expect(s.deps.check).toHaveBeenCalledOnce();
    expect(s.update.install).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("cancels poll timers and closes a late check result after disposal", async () => {
    vi.useFakeTimers();
    const s = setup();
    const pending = deferred<typeof s.update>();
    s.deps.check.mockReturnValueOnce(pending.promise);
    s.store.startBackgroundPolling();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.deps.check).toHaveBeenCalledOnce();
    s.dispose();
    pending.resolve(s.update);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(s.deps.check).toHaveBeenCalledOnce();
    expect(s.store.available()).toBeNull();
    expect(s.update.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an in-flight background check after polling was disabled", async () => {
    vi.useFakeTimers();
    const s = setup();
    const pending = deferred<typeof s.update>();
    s.deps.check.mockReturnValueOnce(pending.promise);
    s.store.startBackgroundPolling();
    await vi.advanceTimersByTimeAsync(30_000);
    s.store.stopBackgroundPolling();
    pending.resolve(s.update);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.store.available()).toBeNull();
    expect(s.update.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    s.dispose();
  });
});

describe("nightly channel", () => {
  it("checks the selected channel", async () => {
    const s = setup();
    s.setChannel("nightly");
    await s.store.checkNow();
    expect(s.deps.check).toHaveBeenCalledWith("nightly");
    s.dispose();
  });

  it("backs up after saving and before installing a nightly update", async () => {
    const s = setup({ version: "1.0.2-nightly.202610051500" });
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.sequence).toEqual(["download", "lock", "flush", "backup", "install", "restart"]);
    expect(s.options.backupDatabase).toHaveBeenCalledWith("before-1.0.2-nightly.202610051500");
    s.dispose();
  });

  it("also backs up when a nightly build is replaced by a stable release", async () => {
    const s = setup({ version: "1.0.2", currentVersion: "1.0.2-nightly.202610051500" });
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.sequence).toEqual(["download", "lock", "flush", "backup", "install", "restart"]);
    s.dispose();
  });

  it("does not back up stable-to-stable updates", () => {
    expect(updateNeedsBackup({ version: "1.0.1", currentVersion: "1.0.0" })).toBe(false);
    expect(updateNeedsBackup({ version: "1.0.1-rc.1", currentVersion: "1.0.0" })).toBe(false);
  });

  it("never installs without a backup and retries without downloading again", async () => {
    const s = setup({ version: "1.0.2-nightly.202610051500" });
    s.options.backupDatabase.mockImplementationOnce(async () => { s.sequence.push("backup"); throw new Error("disk full"); });
    await s.store.checkNow();
    await s.store.downloadAndInstall();
    expect(s.sequence).toEqual(["download", "lock", "flush", "backup", "unlock"]);
    expect(s.update.install).not.toHaveBeenCalled();
    expect(s.deps.notifyBackupFailure).toHaveBeenCalledOnce();
    expect(s.store.stage()).toBe("error");
    await s.store.downloadAndInstall();
    expect(s.update.download).toHaveBeenCalledOnce();
    expect(s.sequence.slice(5)).toEqual(["lock", "flush", "backup", "install", "restart"]);
    s.dispose();
  });

  it("drops a result that arrives after the channel changed", async () => {
    const s = setup();
    const pending = deferred<typeof s.update>();
    s.deps.check.mockReturnValueOnce(pending.promise);
    const checking = s.store.checkNow();
    s.setChannel("nightly");
    pending.resolve(s.update);
    await checking;
    expect(s.store.available()).toBeNull();
    expect(s.store.manualCheck()).toBeNull();
    expect(s.update.close).toHaveBeenCalledOnce();
    s.dispose();
  });
});
