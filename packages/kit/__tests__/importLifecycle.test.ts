import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

describe("Kit public import lifecycle", () => {
  it("imports the shell and unrelated fixture without host access, DOM changes, timers or application listeners", async () => {
    vi.resetModules();
    await import("solid-js");
    const { delegateEvents } = await import("solid-js/web");
    // Generated JSX installs shared framework delegation during module loading.
    delegateEvents(["click", "keydown", "contextmenu", "mousedown", "input", "mousemove"]);
    const platform = await import("../platform");
    expect(() => platform.getPlatformAdapter()).toThrow("Platform adapter not set");
    expect(() => platform.getKvStore()).toThrow("KvStore not set");
    const host = vi.spyOn(platform, "getPlatformAdapter");
    const kv = vi.spyOn(platform, "getKvStore");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const windowListener = vi.spyOn(window, "addEventListener");
    const documentListener = vi.spyOn(document, "addEventListener");
    const before = document.documentElement.outerHTML;
    await import("../shell");
    await import("./fixtures/module");
    await Promise.resolve();
    expect(host).not.toHaveBeenCalled();
    expect(kv).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(windowListener).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
    expect(() => platform.getPlatformAdapter()).toThrow("Platform adapter not set");
    expect(() => platform.getKvStore()).toThrow("KvStore not set");
  });
});
