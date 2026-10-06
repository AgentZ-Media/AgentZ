import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { checkAstro, findAstroViolations } from "./astro.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentz-astro-"));
for (const [owner, name] of Object.entries({
  "apps/site": "@agentz/site", "apps/scriptz": "@agentz/scriptz-app", "modules/scriptz": "@agentz/scriptz",
  "packages/design": "@agentz/design", "packages/kit": "@agentz/kit", "packages/desktop": "@agentz/desktop",
})) {
  fs.mkdirSync(path.join(root, owner), { recursive: true });
  fs.writeFileSync(path.join(root, owner, "package.json"), JSON.stringify({ name }));
  fs.writeFileSync(path.join(root, owner, "index.ts"), "export const value = 1;");
}
fs.writeFileSync(path.join(root, "apps/site/tsconfig.json"), JSON.stringify({ compilerOptions: {
  baseUrl: ".", paths: { "hidden-kit": ["../../packages/kit/index.ts"], "~/*": ["./*"] },
} }));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const check = (contents) => findAstroViolations(root, "apps/site/index.astro", contents);
const frontmatter = (code) => `---\n${code}\n---\n<h1>Suite</h1>`;

test("Astro permits public design imports and local site imports", () => {
  assert.deepEqual(check(frontmatter(`
import '@agentz/design/tokens.css';
import logo from '@agentz/design/assets/suite-mark.svg?url';
import './index';
import '~/index';
`)), []);
});

test("Astro enforces architecture for direct, alias, physical and native imports", () => {
  for (const specifier of ["@agentz/kit/ui", "@agentz/desktop", "@agentz/scriptz", "@agentz/scriptz-app", "hidden-kit"]) {
    assert.equal(check(frontmatter(`import '${specifier}';`))[0].kind, "boundary", specifier);
  }
  for (const specifier of ["../../packages/design/index.ts", path.join(root, "packages/design/index.ts")]) {
    assert.equal(check(frontmatter(`import '${specifier}';`))[0].kind, "relative", specifier);
  }
  assert.equal(check(frontmatter("import '@tauri-apps/api/core';"))[0].kind, "tauri");
  assert.equal(check(frontmatter("import '@agentz/unregistered';"))[0].kind, "unknown");
});

test("template expressions, attributes, scripts, type imports and require cannot bypass boundaries", () => {
  for (const content of [
    `{await import('@agentz/kit')}`,
    `<div data-value={import('@agentz/kit')} />`,
    `<script>import '@agentz/kit';</script>`,
    `<script src="@agentz/kit" />`,
    `<script src={"@agentz/kit"} />`,
    frontmatter("export * from '@agentz/kit';"),
    frontmatter("type UI = import('@agentz/kit').UI;"),
    frontmatter("import kit = require('@agentz/kit');"),
    frontmatter("require('@agentz/kit');"),
    frontmatter("import(`@agentz/kit`);"),
  ]) assert.equal(check(content)[0].kind, "boundary", content);
  assert.equal(check(`{import('@agentz/' + moduleName)}`)[0].kind, "dynamic");
});

test("Astro colors are checked in declaration values and static or expression styles", () => {
  for (const content of [
    `<style>#face {color: #fff; background: rgba(0,0,0,.5)}</style>`,
    `<div style="color: #abcdef" />`,
    `<div style={{ color: '#fff' }} />`,
    '<div style={`color: #fff; opacity: ${opacity}`} />',
  ]) assert.ok(check(content).some((item) => item.kind === "color"), content);
  assert.deepEqual(check(`<style>
#face, #add:hover { color: var(--text-primary); }
.icon { mask-image: url(#face); content: "#fff"; }
</style><a href="#face">#fff is a sample code</a>`), []);
});

test("Astro diagnostics fail closed and retain useful source locations", () => {
  assert.equal(check(frontmatter("const x = ;"))[0].kind, "parse");
  const violation = check(frontmatter("// Überprüfung\nimport '@agentz/kit';"))[0];
  assert.equal(violation.line, 3);
  assert.equal(violation.column, 8);
  assert.equal(violation.file, "apps/site/index.astro");
});

test("Astro scanner finds nested pages but ignores generated output", () => {
  fs.mkdirSync(path.join(root, "apps/site/src/pages"), { recursive: true });
  fs.mkdirSync(path.join(root, "apps/site/dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/site/src/pages/index.astro"), frontmatter("import '@agentz/kit';"));
  fs.writeFileSync(path.join(root, "apps/site/dist/ignored.astro"), frontmatter("import '@agentz/kit';"));
  const violations = checkAstro(root);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].file, "apps/site/src/pages/index.astro");
});
