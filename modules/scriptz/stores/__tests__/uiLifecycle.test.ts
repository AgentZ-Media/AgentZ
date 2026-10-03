import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "../../lib/storage";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => vi.resetModules());

async function install(getAppState: StorageAdapter["getAppState"]) {
  const { setStorageAdapter } = await import("../../lib/storage");
  setStorageAdapter({ getAppState } as StorageAdapter);
}

describe("UI reads across shell lifetimes", () => {
  it("does not let an old layout read overwrite the next shell's layout", async () => {
    const old = deferred<string | null>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('{"sidebar":true,"inspector":false,"timeline":true}');
    await install(read);
    const { uiStore } = await import("../ui");
    let active = true;
    const oldLoad = uiStore.load(() => active);
    active = false;
    await uiStore.load();
    old.resolve('{"sidebar":false,"inspector":true,"timeline":false}');
    await oldLoad;
    expect([uiStore.sidebarOpen(), uiStore.inspectorOpen(), uiStore.timelineOpen()]).toEqual([true, false, true]);
  });

  it("discards a stale focus choice without caching it for a later visit", async () => {
    const old = deferred<string | null>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue("0");
    await install(read);
    const { uiStore } = await import("../ui");
    let active = true;
    const oldFocus = uiStore.applyFocusForScript("old", () => active);
    active = false;
    uiStore.clearFocus();
    old.resolve("1");
    await oldFocus;
    expect(uiStore.focusMode()).toBe(false);
    await uiStore.applyFocusForScript("old");
    expect(read).toHaveBeenCalledTimes(2);
    expect(uiStore.focusMode()).toBe(false);
  });

  it("retries library preferences while an old shell's read is still pending", async () => {
    const old = deferred<string | null>();
    const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('{"grouping":"folder","sort":"title","collapsed":["new"]}');
    await install(read);
    const { libraryPrefs } = await import("../../components/Library/prefs");
    let active = true;
    const oldLoad = libraryPrefs.load(() => active);
    active = false;
    await libraryPrefs.load();
    old.resolve('{"grouping":"none","sort":"created","collapsed":["old"]}');
    await oldLoad;
    expect(libraryPrefs.grouping()).toBe("folder");
    expect(libraryPrefs.sort()).toBe("title");
    expect([...libraryPrefs.collapsed()]).toEqual(["new"]);
    await libraryPrefs.load();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retries preferences after a failed read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue('{"sort":"title"}');
    await install(read);
    const { libraryPrefs } = await import("../../components/Library/prefs");
    await libraryPrefs.load();
    await libraryPrefs.load();
    expect(read).toHaveBeenCalledTimes(2);
    expect(libraryPrefs.sort()).toBe("title");
  });
});
