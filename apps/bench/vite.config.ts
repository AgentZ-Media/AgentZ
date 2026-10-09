import { defineConfig } from "vite";

// Static site: the benchmark data (data/*.json) is bundled at build time.
export default defineConfig({
  base: "./",
  server: { port: 1490, strictPort: true },
});
