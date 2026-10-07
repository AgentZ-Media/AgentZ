import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import type { UpdateChannel } from "@agentz/kit/platform";
import { createDesktopUpdates, updateNeedsBackup, type StagedUpdate } from "../updates";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

interface FakeUpdate { version: string; currentVersion: string; close: ReturnType<typeof vi.fn> }

function setup({ version = "1.0.1", currentVersion = "1.0.0", autoInstall = true, staged = null as StagedUpdate | null } = {}) {
  const sequence: string[] = [];
  let channel: UpdateChannel = "stable";
  let auto = autoInstall;
  let nativeStaged: StagedUpdate | null = staged;
  const makeUpdate = (v = version): FakeUpdate => ({ version: v, currentVersion, close: vi.fn(async () => {}) });
  let update = makeUpdate();
  const native = {
    check: vi.fn(async (_channel: UpdateChannel) => update as FakeUpdate | null),
    download: vi.fn(async (u: FakeUpdate, onEvent: (event: DownloadEvent) => void) => {
      sequence.push("download");
      onEvent({ event: "Started", data: { contentLength: 10 } });
      onEvent({ event: "Progress", data: { chunkLength: 10 } });
      onEvent({ event: "Finished" });
      nativeStaged = { version: u.version, currentVersion: u.currentVersion };
      return nativeStaged;
    }),
    staged: vi.fn(async () => nativeStaged),
    discard: vi.fn(async () => { sequence.push("discard"); nativeStaged = null; }),
    installNow: vi.fn(async () => { sequence.push("install"); nativeStaged = null; }),
    installOnQuit: vi.fn(async () => { sequence.push("installOnQuit"); const had = !!nativeStaged; nativeStaged = null; return had; }),
  };
  const unlock = vi.fn(() => { sequence.push("unlock"); });
  const options = {
    lockEditing: vi.fn(() => { sequence.push("lock"); return unlock; }),
    restart: vi.fn(async () => { sequence.push("restart"); }),
    backupDatabase: vi.fn(async (_label: string) => { sequence.push("backup"); }),
  };
  const deps = {
    native,
    flush: vi.fn(async () => { sequence.push("flush"); return { ok: true, failed: [] as string[], contentFailed: [] as string[] }; }),
    notifySaveFailure: vi.fn(), notifyUpdateFailure: vi.fn(), notifyBackupFailure: vi.fn(),
    isDevelopment: false,
    updateCheckEnabled: () => true,
    hourlyUpdateCheck: () => true,
    updateChannel: () => channel,
    autoInstall: () => auto,
  };
  const runtime = createDesktopUpdates<FakeUpdate>(options, deps);
  return {
    ...runtime, sequence, options, deps, native, unlock,
    get update() { return update; },
    publish(v: string) { update = makeUpdate(v); },
    setChannel(next: UpdateChannel) { channel = next; },
    setAuto(next: boolean) { auto = next; },
  };
}
afterEach(() => vi.useRealTimers());

describe("downloading", () => {
  it("downloads a found update in the background without touching the editor and never restarts", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    expect(s.sequence).toEqual(["download"]);
    expect(s.store.available()).toEqual({ version: "1.0.1" });
    expect(s.store.progress()).toBe(100);
    expect(s.options.lockEditing).not.toHaveBeenCalled();
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.update.close).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("only offers the update when automatic downloads are off", async () => {
    const s = setup({ autoInstall: false });
    await s.store.checkNow();
    expect(s.store.stage()).toBe("available");
    expect(s.native.download).not.toHaveBeenCalled();
    await s.store.download();
    expect(s.store.stage()).toBe("ready");
    s.dispose();
  });

  it("retries a failed background download quietly with the next check", async () => {
    const s = setup();
    s.native.download.mockRejectedValueOnce(new Error("network unavailable"));
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.native.download).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(s.store.stage()).toBe("available"));
    expect(s.deps.notifyUpdateFailure).not.toHaveBeenCalled();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.dispose();
  });

  it("reports a failed download the user asked for", async () => {
    const s = setup({ autoInstall: false });
    s.native.download.mockRejectedValueOnce(new Error("network unavailable"));
    await s.store.checkNow();
    await s.store.download();
    expect(s.store.stage()).toBe("error");
    expect(s.deps.notifyUpdateFailure).toHaveBeenCalledOnce();
    // The retry button downloads again.
    await s.store.restart();
    expect(s.store.stage()).toBe("ready");
    expect(s.options.lockEditing).not.toHaveBeenCalled();
    s.dispose();
  });

  it("serializes duplicate clicks and ignores checks while downloading", async () => {
    const s = setup({ autoInstall: false });
    const pending = deferred<StagedUpdate>();
    s.native.download.mockReturnValueOnce(pending.promise);
    await s.store.checkNow();
    const first = s.store.download();
    await s.store.download();
    await s.store.checkNow();
    pending.resolve({ version: "1.0.1", currentVersion: "1.0.0" });
    await first;
    expect(s.native.download).toHaveBeenCalledOnce();
    expect(s.native.check).toHaveBeenCalledOnce();
    expect(s.store.stage()).toBe("ready");
    s.dispose();
  });

  it("closes the checked update when the window goes away during the download", async () => {
    const s = setup();
    const pending = deferred<StagedUpdate>();
    s.native.download.mockReturnValueOnce(pending.promise);
    await s.store.checkNow();
    const update = s.update;
    s.dispose();
    expect(update.close).not.toHaveBeenCalled();
    pending.resolve({ version: "1.0.1", currentVersion: "1.0.0" });
    await vi.waitFor(() => expect(update.close).toHaveBeenCalledOnce());
    expect(s.store.stage()).toBe("downloading");
  });

  it("picks up an update a closed window already downloaded", async () => {
    const s = setup({ staged: { version: "1.0.1", currentVersion: "1.0.0" } });
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    // The same version found again is not downloaded twice.
    await s.store.checkNow();
    expect(s.native.download).not.toHaveBeenCalled();
    expect(s.store.stage()).toBe("ready");
    expect(s.store.manualCheck()).toBeNull();
    s.dispose();
  });

  it("replaces a downloaded update with a newer one", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.publish("1.0.2");
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.available()).toEqual({ version: "1.0.2" }));
    expect(s.native.download).toHaveBeenCalledTimes(2);
    expect(s.store.stage()).toBe("ready");
    s.dispose();
  });
});

describe("restart now", () => {
  it("locks editing, saves, installs and restarts, and stays frozen", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    await s.store.restart();
    expect(s.sequence).toEqual(["download", "lock", "flush", "install", "restart"]);
    expect(s.unlock).not.toHaveBeenCalled();
    s.dispose();
    expect(s.unlock).toHaveBeenCalledOnce();
  });

  it("aborts on a failed save, unlocks and keeps the download", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.deps.flush.mockImplementationOnce(async () => { s.sequence.push("flush"); return { ok: false, failed: ["editor"], contentFailed: ["editor"] }; });
    await s.store.restart();
    expect(s.sequence).toEqual(["download", "lock", "flush", "unlock"]);
    expect(s.native.installNow).not.toHaveBeenCalled();
    expect(s.deps.notifySaveFailure).toHaveBeenCalledOnce();
    expect(s.store.stage()).toBe("error");
    await s.store.restart();
    expect(s.native.download).toHaveBeenCalledOnce();
    expect(s.sequence.slice(4)).toEqual(["lock", "flush", "install", "restart"]);
    s.dispose();
  });

  it("does nothing while close or quit already owns the editing lock", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.options.lockEditing.mockImplementationOnce(() => { throw new Error("lifecycle busy"); });
    await s.store.restart();
    expect(s.deps.flush).not.toHaveBeenCalled();
    expect(s.native.installNow).not.toHaveBeenCalled();
    expect(s.store.stage()).toBe("error");
    s.dispose();
  });

  it("unlocks after a failed installation and installs again on retry", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.native.installNow.mockRejectedValueOnce(new Error("installer failed"));
    await s.store.restart();
    expect(s.store.stage()).toBe("error");
    expect(s.unlock).toHaveBeenCalledOnce();
    expect(s.deps.notifyUpdateFailure).toHaveBeenCalledOnce();
    await s.store.restart();
    expect(s.native.installNow).toHaveBeenCalledTimes(2);
    expect(s.options.restart).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("after a failed relaunch saves again but never reinstalls", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.options.restart.mockRejectedValueOnce(new Error("restart failed"));
    await s.store.restart();
    expect(s.store.stage()).toBe("error");
    await s.store.checkNow();
    expect(s.native.check).toHaveBeenCalledOnce();
    await s.store.restart();
    expect(s.native.installNow).toHaveBeenCalledOnce();
    expect(s.deps.flush).toHaveBeenCalledTimes(2);
    expect(s.options.restart).toHaveBeenCalledTimes(2);
    s.dispose();
  });

  it("does not relaunch when the window goes away during the installation", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    const pending = deferred<void>();
    s.native.installNow.mockReturnValueOnce(pending.promise);
    const restarting = s.store.restart();
    await vi.waitFor(() => expect(s.native.installNow).toHaveBeenCalledOnce());
    s.dispose();
    pending.resolve();
    await restarting;
    expect(s.options.restart).not.toHaveBeenCalled();
    expect(s.unlock).toHaveBeenCalledOnce();
  });
});

describe("installing on quit", () => {
  it("installs the downloaded update when the app quits", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    await s.prepareExit();
    expect(s.sequence).toEqual(["download", "installOnQuit"]);
    expect(s.options.lockEditing).not.toHaveBeenCalled();
    expect(s.options.restart).not.toHaveBeenCalled();
    // Nothing installs twice, even if quitting is cancelled and repeated.
    await s.prepareExit();
    expect(s.native.installOnQuit).toHaveBeenCalledOnce();
    s.dispose();
  });

  it("does nothing without a downloaded update", async () => {
    const s = setup({ autoInstall: false });
    await s.store.checkNow();
    await s.prepareExit();
    expect(s.native.installOnQuit).not.toHaveBeenCalled();
    s.dispose();
  });

  it("never throws, so a failure cannot keep the app open", async () => {
    const s = setup();
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.native.installOnQuit.mockRejectedValueOnce(new Error("needs a password"));
    await expect(s.prepareExit()).resolves.toBeUndefined();
    s.dispose();
  });
});

describe("nightly channel", () => {
  it("checks the selected channel", async () => {
    const s = setup();
    s.setChannel("nightly");
    await s.store.checkNow();
    expect(s.native.check).toHaveBeenCalledWith("nightly");
    s.dispose();
  });

  it("backs up after saving and before installing a nightly update", async () => {
    const s = setup({ version: "1.0.2-nightly.202610051500" });
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    await s.store.restart();
    expect(s.sequence).toEqual(["download", "lock", "flush", "backup", "install", "restart"]);
    expect(s.options.backupDatabase).toHaveBeenCalledWith("before-1.0.2-nightly.202610051500");
    s.dispose();
  });

  it("backs up before installing on quit, and does not install without the backup", async () => {
    const s = setup({ version: "1.0.2", currentVersion: "1.0.2-nightly.202610051500" });
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.options.backupDatabase.mockImplementationOnce(async () => { s.sequence.push("backup"); throw new Error("disk full"); });
    await s.prepareExit();
    expect(s.native.installOnQuit).not.toHaveBeenCalled();
    await s.prepareExit();
    expect(s.sequence.slice(1)).toEqual(["backup", "backup", "installOnQuit"]);
    s.dispose();
  });

  it("does not back up stable-to-stable updates", () => {
    expect(updateNeedsBackup({ version: "1.0.1", currentVersion: "1.0.0" })).toBe(false);
    expect(updateNeedsBackup({ version: "1.0.1-rc.1", currentVersion: "1.0.0" })).toBe(false);
  });

  it("never installs without a backup and retries without downloading again", async () => {
    const s = setup({ version: "1.0.2-nightly.202610051500" });
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.options.backupDatabase.mockImplementationOnce(async () => { s.sequence.push("backup"); throw new Error("disk full"); });
    await s.store.restart();
    expect(s.sequence).toEqual(["download", "lock", "flush", "backup", "unlock"]);
    expect(s.native.installNow).not.toHaveBeenCalled();
    expect(s.deps.notifyBackupFailure).toHaveBeenCalledOnce();
    await s.store.restart();
    expect(s.native.download).toHaveBeenCalledOnce();
    expect(s.sequence.slice(5)).toEqual(["lock", "flush", "backup", "install", "restart"]);
    s.dispose();
  });

  it("drops an update downloaded for the channel the user left", async () => {
    const s = setup({ version: "1.0.2-nightly.202610051500" });
    s.setChannel("nightly");
    await s.store.checkNow();
    await vi.waitFor(() => expect(s.store.stage()).toBe("ready"));
    s.setChannel("stable");
    s.native.check.mockResolvedValueOnce(null);
    await s.store.checkNow();
    expect(s.native.discard).toHaveBeenCalledOnce();
    expect(s.store.stage()).toBe("idle");
    expect(s.store.manualCheck()).toEqual({ kind: "uptodate" });
    await s.prepareExit();
    expect(s.native.installOnQuit).not.toHaveBeenCalled();
    s.dispose();
  });

  it("drops a result that arrives after the channel changed", async () => {
    const s = setup();
    const pending = deferred<FakeUpdate | null>();
    s.native.check.mockReturnValueOnce(pending.promise);
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

describe("background polling", () => {
  it("cancels poll timers and closes a late check result after disposal", async () => {
    vi.useFakeTimers();
    const s = setup();
    const pending = deferred<FakeUpdate | null>();
    s.native.check.mockReturnValueOnce(pending.promise);
    s.store.startBackgroundPolling();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(s.native.check).toHaveBeenCalledOnce();
    s.dispose();
    pending.resolve(s.update);
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
    expect(s.native.check).toHaveBeenCalledOnce();
    expect(s.store.available()).toBeNull();
    expect(s.update.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores an in-flight background check after polling was disabled", async () => {
    vi.useFakeTimers();
    const s = setup();
    const pending = deferred<FakeUpdate | null>();
    s.native.check.mockReturnValueOnce(pending.promise);
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
