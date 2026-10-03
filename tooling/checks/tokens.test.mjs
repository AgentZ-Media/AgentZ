import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkTokens, findTokenViolations, readLegacyTokens } from "./tokens.mjs";

const aliases = new Set(["--fg-muted", "--brand-500", "--font-ui"]);
const find = (filename, contents) => findTokenViolations(filename, contents, aliases);

test("checks Kit and new products, including standalone fixture sources", () => {
  for (const filename of ["packages/kit/ui/Modal.css", "apps/other/src/index.html", "modules/other/ui.tsx",
    "packages/kit/__tests__/fixtures/demo/style.css", "apps/site/styles.css"]) {
    const css = ":root { --brand-500: var(--fg); color: var(--fg-muted); }";
    assert.equal(find(filename, filename.endsWith(".tsx") ? `const style = ${JSON.stringify(css)};` : css).length, 2, filename);
  }
});

test("uses exact aliases from the canonical stylesheet, without semantic prefix collisions", () => {
  const actual = readLegacyTokens();
  assert.ok(actual.has("--fg-muted"));
  assert.ok(actual.has("--brand-500"));
  assert.ok(!actual.has("--fg"));
  assert.deepEqual(find("packages/kit/ui.css", ".ui { color: var(--fg); --brand-500-extra: 1; --fg-mutedness: 2; }"), []);
});

test("allows the existing ScriptZ compatibility layer but no similarly named product", () => {
  const code = '@import "@agentz/design/legacy.css"; :root { --fg-muted: red; }';
  for (const filename of ["apps/scriptz/src/style.css", "modules/scriptz/styles/global.css", "packages/design/legacy.css"]) {
    assert.deepEqual(find(filename, code), []);
  }
  assert.equal(find("apps/scriptz-next/styles.css", code).length, 2);
});

test("rejects legacy CSS imports through JS, CSS and HTML entry points", () => {
  for (const code of [
    'import "@agentz/design/legacy.css";',
    'export * from "@agentz/design/legacy.css";',
    'import("@agentz/design/legacy.css?inline");',
    'require(`../../design/legacy.css`);',
  ]) assert.equal(find("packages/kit/index.ts", code).filter((v) => v.kind === "import").length, 1, code);
  for (const code of ['@import "@agentz/design/legacy.css";', '@import url(../../design/legacy.css);']) {
    assert.equal(find("packages/kit/style.css", code).length, 1, code);
  }
  for (const code of ['<link rel="stylesheet" href="/design/legacy.css">',
    '<script type="module">import "@agentz/design/legacy.css";</script>']) {
    assert.equal(find("apps/new/index.html", code).length, 1, code);
  }
  assert.deepEqual(find("packages/kit/index.ts", 'import "@agentz/design/tokens.css";'), []);
});

test("checks JS style properties and values while ignoring source comments", () => {
  const code = '// var(--fg-muted)\n/* --brand-500 */\nconst style = { "--font-ui": "var(--fg-muted)" };';
  const violations = find("packages/kit/style.ts", code);
  assert.deepEqual(violations.map((v) => v.value), ["--font-ui", "--fg-muted"]);
  assert.deepEqual(violations.map((v) => v.line), [3, 3]);
  assert.deepEqual(find("packages/kit/style.css", "/* --fg-muted\n @import 'legacy.css'; */"), []);
});

test("repository scan includes new packages and excludes generated output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentz-tokens-"));
  try {
    const write = (filename, content) => {
      const absolute = path.join(root, filename);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    };
    write("packages/design/legacy.css", ":root { --old: var(--fg); }");
    write("packages/kit/__tests__/fixtures/style.css", ".bad { color: var(--old); }");
    write("apps/new/style.ts", 'const value = "var(--old)";');
    write("apps/new/dist/style.css", ".ignore { color: var(--old); }");
    write("modules/scriptz/styles.css", ".existing { color: var(--old); }");
    assert.deepEqual(checkTokens(root).map((v) => v.file).sort(), [
      "apps/new/style.ts", "packages/kit/__tests__/fixtures/style.css",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
