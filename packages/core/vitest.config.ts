import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    // Component tests render with Solid's client runtime (not the SSR
    // build that the default node conditions would pick).
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
