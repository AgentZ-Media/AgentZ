import assert from "node:assert/strict";
import test from "node:test";
import { findColorViolations } from "./colors.mjs";

test("rejects hex, RGB and RGBA UI literals, including fallbacks", () => {
  for (const literal of ["#fff", "#ffff", "#f0e1d2", "#f0e1d2a3", "rgb(0 0 0)", "rgba(0, 0, 0, .1)"]) {
    assert.equal(findColorViolations("modules/demo/View.tsx", `const style = {color: '${literal}'};`).length, 1, literal);
    assert.equal(findColorViolations("apps/demo/style.css", `.ui {color: var(--fg, ${literal})}`).length, 1, literal);
  }
  assert.equal(findColorViolations("packages/kit/Modal.css", ".modal { background: #fff }").length, 1);
});

test("allows semantic tokens and central design literals", () => {
  assert.deepEqual(findColorViolations("modules/demo/style.css", ".ui { color: var(--fg); }"), []);
  assert.deepEqual(findColorViolations("packages/design/tokens.css", ":root { --fg: #fff; }"), []);
});

test("content exception does not exempt other literals in the same file", () => {
  const filename = "modules/scriptz/styles/tokens.css";
  const violations = findColorViolations(filename, "  --char-1: #e0791f;\n  --ui-bad: #fff;\n  --char-1: #e0791f; color: #fff;");
  assert.deepEqual(violations.map(({ line }) => line), [2, 3]);
  assert.deepEqual(findColorViolations("modules/scriptz/components/Editor/plugins/colorPicker.tsx", 'const NEUTRAL_PLACEHOLDER = "#9aa0a6";'), []);
  assert.equal(findColorViolations("modules/scriptz/components/Editor/plugins/colorPicker.tsx", 'const BUTTON_COLOR = "#9aa0a6";').length, 1);
});

test("ignores comments and fixture data while preserving line numbers", () => {
  assert.deepEqual(findColorViolations("modules/demo/__tests__/View.test.tsx", 'const color = "#fff"'), []);
  const violations = findColorViolations("apps/site/style.css", "/* #fff\n rgb(0 0 0) */\n.bad { color: #000; }");
  assert.equal(violations[0].line, 3);
});
