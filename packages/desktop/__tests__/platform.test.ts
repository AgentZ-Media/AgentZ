import { expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load } }));
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: () => "macos",
  version: () => "15.4.1",
  arch: () => { throw new Error("not available"); },
  locale: async () => "de-DE",
}));
import { createDesktopPlatform } from "../lib/platform";

it("opens the app-specific DB lazily, shares its connection and retries a failed open", async () => {
  const db = { select: vi.fn(), execute: vi.fn() };
  load.mockRejectedValueOnce(new Error("temporarily locked")).mockResolvedValue(db);
  const platform = createDesktopPlatform("kit-lab");
  expect(load).not.toHaveBeenCalled();
  await expect(platform.getDb()).rejects.toThrow("temporarily locked");
  expect(await platform.getDb()).toBe(db);
  expect(await platform.getDb()).toBe(db);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith("sqlite:kit-lab.db");
  expect(() => createDesktopPlatform("../scriptz")).toThrow("Invalid desktop app ID");
});

it("reports OS details and leaves out what the host cannot read", async () => {
  const platform = createDesktopPlatform("kit-lab");
  expect(await platform.systemInfo?.()).toEqual({ os: "macos", osVersion: "15.4.1", arch: undefined, locale: "de-DE" });
});

it("rejects unreleasable IDs before opening a database", () => {
  const before = load.mock.calls.length;
  for (const id of ["notes-", "notes--pro", "Notes", "-notes", "../notes"]) {
    expect(() => createDesktopPlatform(id)).toThrow("Invalid desktop app ID");
  }
  for (const id of ["a", "notes-pro", "notes-pro-2"]) {
    expect(() => createDesktopPlatform(id)).not.toThrow();
  }
  expect(load.mock.calls.length).toBe(before);
});

it("marks only nightly workflow builds as nightly", async () => {
  const { readBuildInfo } = await import("../lib/platform");
  expect(readBuildInfo({})).toEqual({ channel: "stable" });
  expect(readBuildInfo({ VITE_AGENTZ_BUILD_CHANNEL: "stable", VITE_AGENTZ_BUILD_COMMIT: "abc" })).toEqual({ channel: "stable" });
  expect(readBuildInfo({
    VITE_AGENTZ_BUILD_CHANNEL: "nightly", VITE_AGENTZ_BUILD_COMMIT: " 479ff19 ", VITE_AGENTZ_BUILD_TIME: "",
  })).toEqual({ channel: "nightly", commit: "479ff19", builtAt: undefined });
  expect(readBuildInfo({ DEV: true })).toEqual({ channel: "stable", development: true });
  expect(readBuildInfo({ DEV: true, VITE_AGENTZ_BUILD_CHANNEL: "nightly" })).toMatchObject({ channel: "nightly", development: true });
});
