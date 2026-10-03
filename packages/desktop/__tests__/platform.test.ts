import { expect, it, vi } from "vitest";
const load = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load } }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos" }));
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
