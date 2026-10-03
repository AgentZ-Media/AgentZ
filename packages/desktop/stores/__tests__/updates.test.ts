import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { createDesktopUpdates } from "../updates";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const sequence: string[] = [];
  const update = {
    version: "1.0.1",
    download: vi.fn(async (_event?: (event: DownloadEvent) => void) => { sequence.push("download"); }),
    install: vi.fn(async () => { sequence.push("install"); }),
    close: vi.fn(async () => {}),
  };
  const unlock = vi.fn(() => { sequence.push("unlock"); });
  const options = {
    lockEditing: vi.fn(() => { sequence.push("lock"); return unlock; }),
    restart: vi.fn(async () => { sequence.push("restart"); }),
  };
  const deps = {
    check: vi.fn(async () => update),
    flush: vi.fn(async () => { sequence.push("flush"); return { ok: true, failed: [] as string[], contentFailed: [] as string[] }; }),
    notifySaveFailure: vi.fn(), notifyUpdateFailure: vi.fn(),
    isDevelopment: false,
    updateCheckEnabled: () => true,
    hourlyUpdateCheck: () => true,
  };
  const runtime = createDesktopUpdates(options, deps);
  return { ...runtime, sequence, update, unlock, options, deps };
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
