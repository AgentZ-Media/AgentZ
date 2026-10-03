import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import { createArchitectureRule } from "./architecture.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentz-boundaries-"));
const workspaceNames = {
  "packages/design": "@agentz/design",
  "packages/kit": "@agentz/kit",
  "packages/desktop": "@agentz/desktop",
  "modules/scriptz": "@agentz/scriptz",
  "modules/notes": "@agentz/notes-module",
  "apps/scriptz": "@agentz/scriptz-app",
  "apps/notes": "@agentz/notes-app",
  "apps/site": "@agentz/site",
  "tooling/vitest-preset": "@agentz/vitest-preset",
};
for (const [directory, name] of Object.entries(workspaceNames)) {
  fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(path.join(root, directory, "package.json"), JSON.stringify({ name }));
  fs.writeFileSync(path.join(root, directory, "index.ts"), "export const value = 1;");
}
fs.writeFileSync(path.join(root, "modules/scriptz/tsconfig.json"), JSON.stringify({
  compilerOptions: { baseUrl: ".", paths: { "hidden-product/*": ["../notes/*"], "~/*": ["./*"], "hidden-tauri": ["../../node_modules/@tauri-apps/api/index.d.ts"] } },
}));
fs.mkdirSync(path.join(root, "node_modules/@tauri-apps/api"), { recursive: true });
fs.writeFileSync(path.join(root, "node_modules/@tauri-apps/api/index.d.ts"), "export const invoke: unknown;");
after(() => fs.rmSync(root, { recursive: true, force: true }));

function lint(owner, code, name = "index.ts") {
  const linter = new Linter({ cwd: root });
  return linter.verify(code, [{
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parser: tseslint.parser },
    plugins: { agentz: { rules: { architecture: createArchitectureRule(root) } } },
    rules: { "agentz/architecture": "error" },
  }], { filename: path.join(root, owner, name) });
}

test("enforces the full workspace dependency matrix", () => {
  const allowed = {
    "packages/design": [],
    "packages/kit": ["packages/design"],
    "packages/desktop": ["packages/design", "packages/kit"],
    "modules/scriptz": ["packages/design", "packages/kit"],
    "modules/notes": ["packages/design", "packages/kit"],
    "apps/scriptz": ["packages/design", "packages/kit", "packages/desktop", "modules/scriptz"],
    "apps/notes": ["packages/design", "packages/kit", "packages/desktop", "modules/notes"],
    "apps/site": ["packages/design"],
  };
  for (const [source, targets] of Object.entries(allowed)) {
    for (const [target, name] of Object.entries(workspaceNames)) {
      const messages = lint(source, `import '${name}';`);
      const permits = source === target || targets.includes(target);
      assert.equal(messages.length, permits ? 0 : 1, `${source} -> ${target}: ${JSON.stringify(messages)}`);
      if (!permits) assert.equal(messages[0].messageId, "boundary");
    }
  }
});

test("blocks all static, reexport, type and dynamic forms of Tauri in product code", () => {
  for (const code of [
    "import { invoke } from '@tauri-apps/api/core';",
    "export { invoke } from '@tauri-apps/api/core';",
    "export * from '@tauri-apps/api/core';",
    "import('@tauri-apps/api/core');",
    "import(`@tauri-apps/api/core`);",
    "require('@tauri-apps/api/core');",
    "import native = require('@tauri-apps/api/core');",
    "type Native = import('@tauri-apps/api/core').Invoke;",
  ]) {
    const messages = lint("modules/scriptz", code);
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].messageId, "tauri", code);
  }
  assert.equal(lint("packages/kit", "import '@tauri-apps/api/core';")[0].messageId, "tauri");
  assert.equal(lint("packages/design", "import '@tauri-apps/api/core';")[0].messageId, "tauri");
  assert.equal(lint("apps/site", "import '@tauri-apps/api/core';")[0].messageId, "tauri");
  assert.deepEqual(lint("packages/desktop", "import '@tauri-apps/api/core';"), []);
  assert.deepEqual(lint("apps/scriptz", "import '@tauri-apps/api/core';"), []);
});

test("relative paths cannot bypass boundaries, even toward otherwise allowed packages", () => {
  for (const code of [
    "import '../../packages/design/index';",
    "export * from '../notes/index';",
    "import('../notes/index');",
    `import ${JSON.stringify(path.join(root, "packages/design/index.ts"))};`,
  ]) assert.equal(lint("modules/scriptz", code)[0].messageId, "relative", code);
  assert.deepEqual(lint("modules/scriptz", "import './index';"), []);
});

test("tsconfig paths do not hide a foreign module or native API", () => {
  assert.equal(lint("modules/scriptz", "import 'hidden-product/index';")[0].messageId, "boundary");
  assert.equal(lint("modules/scriptz", "import 'hidden-tauri';")[0].messageId, "tauri");
  assert.deepEqual(lint("modules/scriptz", "import '~/index';"), []);
});

test("tooling access is limited to the exact test config and public preset entry", () => {
  assert.deepEqual(lint("modules/scriptz", "import '@agentz/vitest-preset';", "vitest.config.ts"), []);
  assert.equal(lint("modules/scriptz", "import '@agentz/vitest-preset';")[0].messageId, "boundary");
  assert.equal(lint("modules/scriptz", "import '@agentz/vitest-preset/internal';", "vitest.config.ts")[0].messageId, "boundary");
});

test("unregistered suite packages and computed imports fail closed", () => {
  assert.equal(lint("modules/scriptz", "import '@agentz/future-product';")[0].messageId, "unknown");
  assert.equal(lint("modules/scriptz", "import('@agentz/' + product);")[0].messageId, "dynamic");
  assert.equal(lint("modules/scriptz", "require(dependency);")[0].messageId, "dynamic");
  assert.deepEqual(lint("modules/scriptz", "import 'solid-js';"), []);
});
