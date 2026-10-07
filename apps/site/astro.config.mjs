import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "astro/config";

// /api/stats.json is a Vercel rewrite to the production backend (vercel.json). The
// dev server proxies it to the deployment of .env.local instead.
const localEnv = new URL(".env.local", import.meta.url);
const convexSite = process.env.PUBLIC_CONVEX_SITE_URL
  ?? (existsSync(localEnv) ? parseEnv(readFileSync(localEnv, "utf8")).PUBLIC_CONVEX_SITE_URL : undefined);

export default defineConfig({
  site: "https://www.agentz-suite.com",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  vite: {
    server: {
      proxy: convexSite ? { "/api/stats.json": { target: convexSite, changeOrigin: true, rewrite: () => "/stats" } } : {},
    },
  },
});
