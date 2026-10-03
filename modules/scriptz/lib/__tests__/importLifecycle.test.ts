import { afterEach, describe, expect, it, vi } from "vitest";

// This intentionally does not render or register a test adapter. resetModules
// also removes registration performed by any package-level test setup.
afterEach(() => vi.restoreAllMocks());

describe("ScriptZ import lifecycle", () => {
  it("imports the public module and complete shell without host I/O or runtime effects", async () => {
    vi.resetModules();
    // Framework initialization is outside ScriptZ's lifecycle contract.
    await import("solid-js");
    const { delegateEvents } = await import("solid-js/web");
    // Solid's JSX compiler installs one shared document delegate per event at
    // module evaluation. Warm those framework delegates so the assertions below
    // cover app-owned listeners (settings, clock, shortcuts), not generated JSX.
    delegateEvents(["click", "keydown", "contextmenu", "mousedown", "input", "mousemove"]);
    await import("lexical");
    const storage = await import("../storage");
    const platform = await import("@agentz/kit/platform");
    expect(() => storage.getStorageAdapter()).toThrow("Storage adapter not set");
    expect(() => platform.getPlatformAdapter()).toThrow("Platform adapter not set");

    const storageAccess = vi.spyOn(storage, "getStorageAdapter");
    const platformAccess = vi.spyOn(platform, "getPlatformAdapter");
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    const windowListener = vi.spyOn(window, "addEventListener");
    const documentListener = vi.spyOn(document, "addEventListener");
    const before = document.documentElement.outerHTML;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(document.documentElement, {
      attributes: true, childList: true, subtree: true, characterData: true,
    });

    await import("../../index");
    await import("../../components/Shell/AppShell");
    // Include immediately queued effects, not just the synchronous module body.
    await Promise.resolve();
    await Promise.resolve();

    expect(storageAccess).not.toHaveBeenCalled();
    expect(platformAccess).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
    expect(windowListener).not.toHaveBeenCalled();
    expect(documentListener).not.toHaveBeenCalled();
    mutations.push(...observer.takeRecords());
    expect(mutations).toHaveLength(0);
    observer.disconnect();
    expect(document.documentElement.outerHTML).toBe(before);
    // Importing api must not quietly install a default SQL adapter either.
    expect(() => storage.getStorageAdapter()).toThrow("Storage adapter not set");
  });
});
