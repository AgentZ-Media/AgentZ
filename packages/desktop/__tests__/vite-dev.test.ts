// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, mergeConfig } from "vite";
import { expect, it } from "vitest";
import { defineDesktopViteConfig } from "../vite";

it("serves Solid and its refresh runtime from a thin app without a direct Solid dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentz-thin-dev-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "thin-app", type: "module" }));
  const server = await createServer(mergeConfig(defineDesktopViteConfig({ port: 1490 }), {
    configFile: false,
    root,
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  }));
  try {
    const resolve = server.config.createResolver({ asSrc: false, scan: true });
    const core = await resolve("solid-js", "/@solid-refresh");
    const web = await resolve("solid-js/web", join(root, "src/index.tsx"));
    const store = await resolve("solid-js/store", join(root, "src/index.tsx"));
    expect(core).toMatch(/solid-js\/dist\/dev\.js$/);
    expect(web).toMatch(/solid-js\/web\/dist\/dev\.js$/);
    expect(store).toMatch(/solid-js\/store\/dist\/dev\.js$/);
    const refresh = await server.transformRequest("/@solid-refresh");
    expect(refresh?.code).toContain("createSignal");
    expect(refresh?.code).not.toMatch(/from\s*['"]solid-js['"]/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
