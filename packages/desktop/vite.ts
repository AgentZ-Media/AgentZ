import { createRequire } from "node:module";
import { dirname } from "node:path";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** Node-only entry point; never re-exported by the browser host. */
export function defineDesktopViteConfig({ port }: { port: number }) {
  if (!Number.isInteger(port) || port < 1024 || port >= 65535) {
    throw new Error("Desktop port must leave room for its adjacent HMR port");
  }
  const host = process.env.TAURI_DEV_HOST;
  // Solid refresh resolves its virtual imports from the app root. Thin apps
  // depend on the host, so pin all Solid subpaths to the host-owned package.
  // Keep directory resolution so Vite still applies browser/dev conditions.
  const solidRoot = dirname(createRequire(import.meta.url).resolve("solid-js/package.json"));
  return defineConfig({
    plugins: [solid()],
    clearScreen: false,
    resolve: { alias: { "solid-js": solidRoot } },
    server: {
      port, strictPort: true, host: host || false,
      hmr: host ? { protocol: "ws", host, port: port + 1 } : undefined,
      watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**"] },
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: { target: "es2022", minify: "esbuild", sourcemap: false },
  });
}
