// Sanity tests for the platform-aware keyboard helpers.
//
// K() / isModKey() read the active platform from the
// PlatformAdapter via getPlatform(). For the tests to run deterministically,
// we register a stub adapter before each block.

import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  setPlatformAdapter,
  type PlatformAdapter,
  type Platform,
} from "../platform";
import { K, getPlatform, isMac, isModKey } from "../keys";

function stubAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    supportsDirectoryWrite: false,
    getDb: () =>
      Promise.reject(new Error("no DB needed for these tests")),
    getVersion: () => Promise.resolve("0.0.0"),
    openUrl: () => Promise.resolve(),
    revealInFolder: () => Promise.resolve(),
    saveDialog: () => Promise.resolve(null),
    saveAs: () => Promise.resolve({ cancelled: true, path: null }),
    openFile: () => Promise.resolve(null),
    pickDirectory: () => Promise.resolve(null),
    writeFileTo: () => Promise.resolve(),
  };
}

// Reset between blocks: setPlatformAdapter just overwrites the module-
// level slot, so re-setting before each `describe` is sufficient.
beforeEach(() => {
  setPlatformAdapter(stubAdapter("macos"));
});
afterEach(() => {
  // Leave a sane default so other test files that share this module
  // don't inherit a weird platform.
  setPlatformAdapter(stubAdapter("macos"));
});

describe("getPlatform / isMac", () => {
  it("reads from the registered adapter", () => {
    setPlatformAdapter(stubAdapter("windows"));
    expect(getPlatform()).toBe("windows");
    expect(isMac()).toBe(false);
  });
  it("returns macos when adapter says macos", () => {
    setPlatformAdapter(stubAdapter("macos"));
    expect(isMac()).toBe(true);
  });
});

describe("isModKey", () => {
  it("watches metaKey on macOS", () => {
    setPlatformAdapter(stubAdapter("macos"));
    expect(isModKey({ metaKey: true, ctrlKey: false })).toBe(true);
    expect(isModKey({ metaKey: false, ctrlKey: true })).toBe(false);
  });
  it("watches ctrlKey on Windows", () => {
    setPlatformAdapter(stubAdapter("windows"));
    expect(isModKey({ metaKey: true, ctrlKey: false })).toBe(false);
    expect(isModKey({ metaKey: false, ctrlKey: true })).toBe(true);
  });
  it("watches ctrlKey on Linux", () => {
    setPlatformAdapter(stubAdapter("linux"));
    expect(isModKey({ metaKey: false, ctrlKey: true })).toBe(true);
  });
});

describe("K", () => {
  it("renders macOS symbols without separator", () => {
    setPlatformAdapter(stubAdapter("macos"));
    expect(K("Mod+B")).toBe("⌘B");
    expect(K("Mod+Shift+S")).toBe("⌘⇧S");
    expect(K("Mod+Alt+ArrowLeft")).toBe("⌘⌥←");
    expect(K("Mod+Shift+H")).toBe("⌘⇧H");
  });

  it("renders Windows labels with `+` separator", () => {
    setPlatformAdapter(stubAdapter("windows"));
    expect(K("Mod+B")).toBe("Ctrl+B");
    expect(K("Mod+Shift+S")).toBe("Ctrl+Shift+S");
    expect(K("Mod+Alt+ArrowLeft")).toBe("Ctrl+Alt+←");
    expect(K("Enter")).toBe("Enter");
  });

  it("renders Linux labels like Windows", () => {
    setPlatformAdapter(stubAdapter("linux"));
    expect(K("Mod+K")).toBe("Ctrl+K");
  });

  it("passes through unknown tokens verbatim", () => {
    setPlatformAdapter(stubAdapter("macos"));
    expect(K("Mod+,")).toBe("⌘,");
    expect(K("Mod+0")).toBe("⌘0");
  });
});
