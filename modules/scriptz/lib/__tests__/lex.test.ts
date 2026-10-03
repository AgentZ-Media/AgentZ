// Sanity tests for the pure Lexical-state extraction helpers.
//
// These cover the parts that the editor reconciliation (scripts.ts)
// depends on every save: which character names exist, who said how many
// words, what teleprompter text comes out. If any of these regresses,
// the per-script characters_meta drifts away from what the editor
// actually shows.

import { describe, it, expect } from "vitest";
import {
  extractBlocks,
  extractCharacterNames,
  extractPlainText,
  extractTeleprompterText,
  dialogWordsByCharacter,
  wordTokenSet,
  jaccardSimilarity,
} from "../lex";

// Helper: build a minimal Lexical-state JSON containing the given block
// kinds + texts. Mirrors what the editor actually persists.
function lex(blocks: Array<{ kind: string; text: string }>): string {
  return JSON.stringify({
    root: {
      children: blocks.map((b) => ({
        type: b.kind,
        children: [{ type: "text", text: b.text }],
      })),
    },
  });
}

describe("extractBlocks", () => {
  it("returns blocks in document order with collected text", () => {
    const json = lex([
      { kind: "scriptz-action", text: "Es regnet." },
      { kind: "scriptz-character", text: "Max" },
      { kind: "scriptz-dialog", text: "Hallo Welt" },
    ]);
    expect(extractBlocks(json)).toEqual([
      {
        kind: "scriptz-action",
        text: "Es regnet.",
        runs: [{ text: "Es regnet.", bold: false, italic: false, underline: false }],
      },
      {
        kind: "scriptz-character",
        text: "Max",
        runs: [{ text: "Max", bold: false, italic: false, underline: false }],
      },
      {
        kind: "scriptz-dialog",
        text: "Hallo Welt",
        runs: [{ text: "Hallo Welt", bold: false, italic: false, underline: false }],
      },
    ]);
  });

  it("returns [] for malformed JSON without throwing", () => {
    expect(extractBlocks("not json")).toEqual([]);
  });

  it("extracts per-run format bits from text nodes", () => {
    const json = JSON.stringify({
      root: {
        children: [
          {
            type: "scriptz-dialog",
            children: [
              { type: "text", text: "plain " },
              { type: "text", text: "bold", format: 1 },
              { type: "text", text: " " },
              { type: "text", text: "italic", format: 2 },
              { type: "text", text: " end" },
            ],
          },
        ],
      },
    });
    expect(extractBlocks(json)).toEqual([
      {
        kind: "scriptz-dialog",
        text: "plain bold italic end",
        runs: [
          { text: "plain ", bold: false, italic: false, underline: false },
          { text: "bold", bold: true, italic: false, underline: false },
          { text: " ", bold: false, italic: false, underline: false },
          { text: "italic", bold: false, italic: true, underline: false },
          { text: " end", bold: false, italic: false, underline: false },
        ],
      },
    ]);
  });
});

describe("extractCharacterNames", () => {
  it("uppercases and dedupes case-insensitively in first-seen order", () => {
    const json = lex([
      { kind: "scriptz-character", text: "max" },
      { kind: "scriptz-dialog", text: "ja" },
      { kind: "scriptz-character", text: "Eva" },
      { kind: "scriptz-character", text: "MAX" },
    ]);
    expect(extractCharacterNames(json)).toEqual(["MAX", "EVA"]);
  });

  it("ignores empty character blocks", () => {
    const json = lex([
      { kind: "scriptz-character", text: "   " },
      { kind: "scriptz-character", text: "Max" },
    ]);
    expect(extractCharacterNames(json)).toEqual(["MAX"]);
  });
});

describe("dialogWordsByCharacter", () => {
  it("attributes each dialog block to the most recent character (uppercase key)", () => {
    const json = lex([
      { kind: "scriptz-character", text: "Max" },
      { kind: "scriptz-dialog", text: "Hallo Welt" }, // 2
      { kind: "scriptz-dialog", text: "Wie geht es dir" }, // 4
      { kind: "scriptz-character", text: "Eva" },
      { kind: "scriptz-dialog", text: "Gut danke" }, // 2
    ]);
    expect(dialogWordsByCharacter(json)).toEqual({ MAX: 6, EVA: 2 });
  });

  it("ensures characters with no dialog get a 0 entry", () => {
    const json = lex([
      { kind: "scriptz-character", text: "Stumm" },
      { kind: "scriptz-action", text: "schweigt." },
    ]);
    expect(dialogWordsByCharacter(json)).toEqual({ STUMM: 0 });
  });

  it("does not count parenthetical words as dialog", () => {
    const json = lex([
      { kind: "scriptz-character", text: "Max" },
      { kind: "scriptz-parenthetical", text: "(sehr leise)" },
      { kind: "scriptz-dialog", text: "Hallo Welt" },
    ]);
    expect(dialogWordsByCharacter(json)).toEqual({ MAX: 2 });
  });

  it("drops dialog before the first character (no anchor)", () => {
    const json = lex([
      { kind: "scriptz-dialog", text: "orphan line" },
      { kind: "scriptz-character", text: "Max" },
      { kind: "scriptz-dialog", text: "Hallo" },
    ]);
    expect(dialogWordsByCharacter(json)).toEqual({ MAX: 1 });
  });
});

describe("extractTeleprompterText", () => {
  it("emits Character, Parenthetical and Dialog", () => {
    const json = lex([
      { kind: "scriptz-action", text: "Es ist Nacht." }, // dropped
      { kind: "scriptz-character", text: "max" },
      { kind: "scriptz-parenthetical", text: "(leise)" },
      { kind: "scriptz-dialog", text: "Hallo." },
    ]);
    expect(extractTeleprompterText(json)).toBe("MAX\n(leise)\nHallo.");
  });

  it("wraps a parenthetical without its own parentheses exactly once", () => {
    const json = lex([
      { kind: "scriptz-character", text: "max" },
      { kind: "scriptz-parenthetical", text: " leise " },
      { kind: "scriptz-dialog", text: "Hallo." },
      { kind: "scriptz-parenthetical", text: "((lacht))" },
    ]);
    expect(extractTeleprompterText(json)).toBe("MAX\n(leise)\nHallo.\n(lacht)");
  });

  it("drops action blocks, also when they are fully in parentheses", () => {
    const json = lex([
      { kind: "scriptz-action", text: "(Schnitt)" },
      { kind: "scriptz-character", text: "max" },
      { kind: "scriptz-dialog", text: "Hallo." },
      { kind: "scriptz-action", text: "(Pause)" },
    ]);
    expect(extractTeleprompterText(json)).toBe("MAX\nHallo.");
  });

  it("returns empty string when no relevant block exists", () => {
    const json = lex([
      { kind: "scriptz-action", text: "Sonnenuntergang." },
      { kind: "scriptz-camera", text: "Weitwinkel" },
    ]);
    expect(extractTeleprompterText(json)).toBe("");
  });
});

describe("extractBlocks - legacy block types", () => {
  it("reports retired block types as action, parenthetical as itself", () => {
    const json = lex([
      { kind: "scriptz-camera", text: "Close-Up" },
      { kind: "scriptz-caption", text: "Büro" },
      { kind: "scriptz-sfx", text: "Pling" },
      { kind: "scriptz-parenthetical", text: "(leise)" },
    ]);
    expect(extractBlocks(json).map((b) => [b.kind, b.text])).toEqual([
      ["scriptz-action", "Close-Up"],
      ["scriptz-action", "Büro"],
      ["scriptz-action", "Pling"],
      ["scriptz-parenthetical", "(leise)"],
    ]);
  });
});

describe("extractPlainText", () => {
  it("writes every block, character upper-cased, parenthetical in parentheses", () => {
    const json = lex([
      { kind: "scriptz-action", text: "Büro." },
      { kind: "scriptz-character", text: "max" },
      { kind: "scriptz-parenthetical", text: "leise" },
      { kind: "scriptz-dialog", text: "Hallo." },
    ]);
    expect(extractPlainText(json)).toBe("Büro.\n\nMAX\n\n(leise)\n\nHallo.");
  });
});

describe("wordTokenSet + jaccardSimilarity", () => {
  it("tokenises with 3-char minimum, lowercases", () => {
    const set = wordTokenSet("Im Wald geht ein Mann.");
    // "im" too short, others kept lowercase
    expect(set.has("wald")).toBe(true);
    expect(set.has("geht")).toBe(true);
    expect(set.has("ein")).toBe(true);
    expect(set.has("mann")).toBe(true);
    expect(set.has("im")).toBe(false);
  });

  it("treats two empty sets as fully similar", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1.0);
  });

  it("computes intersection / union", () => {
    const a = wordTokenSet("Wald Berg Tal");
    const b = wordTokenSet("Berg Tal Fluss");
    // intersection: {berg, tal} = 2; union: {wald, berg, tal, fluss} = 4
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5, 5);
  });
});
