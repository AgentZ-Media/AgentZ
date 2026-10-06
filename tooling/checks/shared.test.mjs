import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { COLOR_LITERAL, lineColumn, sourceFiles } from "./shared.mjs";

test("lineColumn reports 1-based positions across lines", () => {
  const text = "ab\ncd\n\nef";
  assert.deepEqual(lineColumn(text, 0), { line: 1, column: 1 });
  assert.deepEqual(lineColumn(text, 1), { line: 1, column: 2 });
  assert.deepEqual(lineColumn(text, 3), { line: 2, column: 1 });
  assert.deepEqual(lineColumn(text, 7), { line: 4, column: 1 });
});

test("COLOR_LITERAL matches hex and rgb colors but not longer IDs", () => {
  for (const value of ["#abc", "#ABCD", "#a1b2c3", "#a1b2c3d4", "rgb(", "RGBA ("]) assert.ok(COLOR_LITERAL.test(value), value);
  for (const value of ["#ab", "#abcde", "#abcdefg", "torgb("]) assert.ok(!COLOR_LITERAL.test(value), value);
});

test("sourceFiles walks the given directories and skips ignored names", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentz-checks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ["apps/a/x.css", "apps/a/deep/y.tsx", "apps/a/z.ts", "apps/a/node_modules/n.css", "apps/a/dist/d.css",
    "apps/a/src-tauri/s.css", "modules/m/w.css", "other/o.css"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), "");
  }
  const relative = (files) => files.map((file) => path.relative(root, file).split(path.sep).join("/")).sort();
  assert.deepEqual(relative(sourceFiles(root, ["apps", "modules", "packages"], /\.(css|tsx)$/)),
    ["apps/a/deep/y.tsx", "apps/a/x.css", "modules/m/w.css"]);
  assert.deepEqual(relative(sourceFiles(root, ["apps"], /\.css$/, new Set(["deep"]))),
    ["apps/a/dist/d.css", "apps/a/node_modules/n.css", "apps/a/src-tauri/s.css", "apps/a/x.css"]);
});
