// @vitest-environment node
import { fileURLToPath } from "node:url";
import { build } from "vite";
import solid from "vite-plugin-solid";
import { expect, it } from "vitest";

it("retains shared styles when production tree-shaking resolves the public host export", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [solid()],
    build: {
      write: false,
      rollupOptions: {
        input: fileURLToPath(new URL("./fixtures/production-entry.ts", import.meta.url)),
      },
    },
  });
  if ("on" in result) throw new Error("Expected a one-shot production build");
  const outputs = Array.isArray(result) ? result : [result];
  const css = outputs.flatMap((output) => output.output)
    .filter((asset) => asset.type === "asset" && asset.fileName.endsWith(".css"))
    .map((asset) => asset.type === "asset" ? String(asset.source) : "").join("\n");
  // Component CSS alone can still exist when the public barrel is discarded.
  // Require each global layer that previously disappeared from the real app.
  expect(css).toContain('font-family:Schibsted Grotesk Variable');
  expect(css).toContain("--ui:");
  expect(css).toContain("--bg:");
  expect(css).toContain(".btn{");
  expect(css).toContain("box-sizing:border-box");
  expect(css).toContain(".shell{");
  expect(css).toContain(".side{");
  expect(css.indexOf("@font-face")).toBeLessThan(css.indexOf("--ui:"));
  expect(css.indexOf("--ui:")).toBeLessThan(css.indexOf(".btn{"));
  expect(css.indexOf(".btn{")).toBeLessThan(css.indexOf(".shell{"));
});
