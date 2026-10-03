import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

/** Node-only entry point; never re-exported by the browser host. */
export function defineDesktopViteConfig({ port }: { port: number }) {
  if (!Number.isInteger(port) || port < 1024 || port >= 65535) {
    throw new Error("Desktop port must leave room for its adjacent HMR port");
  }
  const host = process.env.TAURI_DEV_HOST;
  return defineConfig({
    plugins: [solid()],
    clearScreen: false,
    server: {
      port, strictPort: true, host: host || false,
      hmr: host ? { protocol: "ws", host, port: port + 1 } : undefined,
      watch: { ignored: ["**/src-tauri/**", "**/target/**", "**/crates/**"] },
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: { target: "es2022", minify: "esbuild", sourcemap: false },
  });
}
