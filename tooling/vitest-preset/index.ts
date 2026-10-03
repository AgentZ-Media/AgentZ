import { defineConfig, mergeConfig, type UserConfig } from "vitest/config";
import solid from "vite-plugin-solid";

/** Shared client-side Solid test defaults; each package owns its setup files. */
export function definePackageTest(overrides: UserConfig = {}) {
  return defineConfig(mergeConfig({
    plugins: [solid()],
    resolve: { conditions: ["browser", "development"] },
    test: { environment: "jsdom", globals: true },
  }, overrides));
}
