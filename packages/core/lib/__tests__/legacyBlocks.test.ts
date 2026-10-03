// Tests for the retired-block-type normalizer (lib/legacyBlocks.ts).

import { describe, expect, it } from "vitest";
import {
  LEGACY_BLOCK_TYPES,
  mayContainLegacyBlocks,
  normalizeLegacyContent,
} from "../legacyBlocks";
import { countWordsInContent } from "../dailyWords";

interface TextNode {
  type: "text";
  text: string;
  format: number;
  detail: number;
  mode: string;
  style: string;
  version: number;
}

function text(t: string, format = 0): TextNode {
  return { type: "text", text: t, format, detail: 0, mode: "normal", style: "", version: 1 };
}

function block(type: string, children: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type,
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    children,
    ...extra,
  };
}

function state(children: unknown[]): string {
  return JSON.stringify({
    root: { type: "root", version: 1, direction: null, format: "", indent: 0, children },
  });
}

type Parsed = {
  root: {
    children: Array<{
      type: string;
      blockType?: string;
      format: string;
      indent: number;
      children: Array<{ type: string; text?: string; format?: number }>;
    }>;
  };
};

function parse(json: string): Parsed {
  return JSON.parse(json) as Parsed;
}

describe("normalizeLegacyContent", () => {
  it("exports the four retired types", () => {
    expect([...LEGACY_BLOCK_TYPES].sort()).toEqual([
      "scriptz-camera",
      "scriptz-caption",
      "scriptz-parenthetical",
      "scriptz-sfx",
    ]);
  });

  it.each(["scriptz-camera", "scriptz-caption", "scriptz-sfx"])(
    "converts %s to action and keeps text + formats",
    (type) => {
      const input = state([
        block(type, [text("Close-"), text("Up", 1), text(" now", 8)], { blockType: type }),
      ]);
      const { json, changed } = normalizeLegacyContent(input);
      expect(changed).toBe(true);
      const b = parse(json).root.children[0];
      expect(b.type).toBe("scriptz-action");
      expect(b.blockType).toBe("scriptz-action");
      expect(b.children).toEqual([text("Close-"), text("Up", 1), text(" now", 8)]);
    },
  );

  it("wraps parenthetical text in parentheses", () => {
    const { json, changed } = normalizeLegacyContent(
      state([block("scriptz-parenthetical", [text("leise")])]),
    );
    expect(changed).toBe(true);
    const b = parse(json).root.children[0];
    expect(b.type).toBe("scriptz-action");
    expect(b.children[0].text).toBe("(leise)");
  });

  it("does not double-wrap an already parenthesized parenthetical", () => {
    const { json } = normalizeLegacyContent(
      state([block("scriptz-parenthetical", [text("(leise)")])]),
    );
    expect(parse(json).root.children[0].children[0].text).toBe("(leise)");
  });

  it("wraps across nested formatted runs, keeping their formats", () => {
    const { json } = normalizeLegacyContent(
      state([
        block("scriptz-parenthetical", [
          text("  "),
          text("sehr", 1),
          text(" leise", 2),
          { type: "linebreak", version: 1 },
          text("und schnell ", 8),
        ]),
      ]),
    );
    const children = parse(json).root.children[0].children;
    expect(children[0].text).toBe("  ");
    expect(children[1]).toMatchObject({ text: "(sehr", format: 1 });
    expect(children[2]).toMatchObject({ text: " leise", format: 2 });
    expect(children[3].type).toBe("linebreak");
    expect(children[4]).toMatchObject({ text: "und schnell) ", format: 8 });
  });

  it("leaves an empty parenthetical empty (no '()')", () => {
    const { json, changed } = normalizeLegacyContent(
      state([block("scriptz-parenthetical", [])]),
    );
    expect(changed).toBe(true);
    const b = parse(json).root.children[0];
    expect(b.type).toBe("scriptz-action");
    expect(b.children).toEqual([]);
  });

  it("does not change the word count", () => {
    const input = state([
      block("scriptz-character", [text("MAX")], { characterName: "MAX" }),
      block("scriptz-parenthetical", [text("sehr leise")]),
      block("scriptz-dialog", [text("Hallo Welt")]),
      block("scriptz-sfx", [text("Pling")]),
    ]);
    const { json } = normalizeLegacyContent(input);
    // countWordsInContent normalizes on its own, so compare raw tokens too.
    const rawTokens = (s: string) =>
      parse(s)
        .root.children.map((b) => b.children.map((c) => c.text ?? "").join(""))
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;
    expect(rawTokens(json)).toBe(rawTokens(input));
    expect(countWordsInContent(json)).toBe(countWordsInContent(input));
  });

  it("returns already-normal content unchanged (same string)", () => {
    const input = state([
      block("scriptz-action", [text("Es regnet.")]),
      block("scriptz-character", [text("MAX")], { characterName: "MAX" }),
      block("scriptz-dialog", [text("Hallo")]),
    ]);
    const out = normalizeLegacyContent(input);
    expect(out.changed).toBe(false);
    expect(out.json).toBe(input);
  });

  it("returns malformed JSON unchanged", () => {
    const broken = '{"root": {"children": [{"type": "scriptz-sfx"';
    expect(mayContainLegacyBlocks(broken)).toBe(true);
    const out = normalizeLegacyContent(broken);
    expect(out).toEqual({ json: broken, changed: false });
  });

  it("keeps unrelated text that merely mentions a legacy type name", () => {
    const input = state([block("scriptz-action", [text("scriptz-camera")])]);
    const out = normalizeLegacyContent(input);
    expect(out.changed).toBe(false);
    expect(out.json).toBe(input);
  });

  it("is idempotent", () => {
    const once = normalizeLegacyContent(
      state([block("scriptz-parenthetical", [text("leise")])]),
    ).json;
    const twice = normalizeLegacyContent(once);
    expect(twice.changed).toBe(false);
    expect(twice.json).toBe(once);
  });
});
