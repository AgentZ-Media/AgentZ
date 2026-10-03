// Tests for the export preview layout (components/Export/pdfPreview.ts).

import { describe, expect, it } from "vitest";
import type { ExtractedBlock } from "../../../lib/lex";
import { A4_H_MM, LINE_HEIGHT_MM, layoutPdfPreview, wrapText } from "../pdfPreview";

const block = (kind: "action" | "character" | "dialog", text: string): ExtractedBlock => ({
  kind: `scriptz-${kind}`,
  text,
  runs: [{ text, bold: false, italic: false, underline: false }],
});

const base = {
  title: "Feierabend",
  characters: [
    { name: "Timo", color: "#2fa56b" },
    { name: "Axel", color: "#d04141" },
  ],
  includeHighlighting: false,
  includeTitlePage: false,
  castLine: "Charaktere: Timo, Axel",
};

describe("wrapText", () => {
  it("wraps greedily by character count", () => {
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
  });
  it("keeps explicit line breaks and empty lines", () => {
    expect(wrapText("a\n\nb", 20)).toEqual(["a", "", "b"]);
  });
  it("never returns an empty array", () => {
    expect(wrapText("", 20)).toEqual([""]);
  });
});

describe("layoutPdfPreview", () => {
  it("puts a short script on one page, character centered and upper-cased", () => {
    const pages = layoutPdfPreview({
      ...base,
      blocks: [block("action", "Timo klappt den Laptop zu."), block("character", "Timo"), block("dialog", "Feierabend!")],
    });
    expect(pages).toHaveLength(1);
    const [act, chr, dia] = pages[0].lines;
    expect(act.align).toBe("left");
    expect(chr.text).toBe("TIMO");
    expect(chr.align).toBe("center");
    expect(chr.bold).toBe(true);
    expect(dia.xMm).toBeGreaterThan(act.xMm);
    expect(dia.widthMm).toBeLessThan(act.widthMm);
    // Lines move down the page.
    expect(chr.baselineMm).toBeGreaterThan(act.baselineMm);
    expect(dia.baselineMm - chr.baselineMm).toBeCloseTo(LINE_HEIGHT_MM + 1.6);
  });

  it("tints character + dialog lines only when highlighting is on", () => {
    const blocks = [block("character", "Axel"), block("dialog", "Hast du mal auf die Uhr geschaut?"), block("action", "Stille.")];
    const off = layoutPdfPreview({ ...base, blocks });
    expect(off[0].lines.every((l) => l.tint === null)).toBe(true);
    const on = layoutPdfPreview({ ...base, blocks, includeHighlighting: true });
    expect(on[0].lines[0].tint).toBe("#d04141");
    expect(on[0].lines[1].tint).toBe("#d04141");
    expect(on[0].lines[2].tint).toBeNull();
  });

  it("adds a title page in front", () => {
    const pages = layoutPdfPreview({ ...base, blocks: [block("action", "Los.")], includeTitlePage: true });
    expect(pages).toHaveLength(2);
    expect(pages[0].lines.map((l) => l.text)).toEqual(["Feierabend", "Charaktere: Timo, Axel"]);
    expect(pages[0].lines[0].baselineMm).toBeCloseTo(A4_H_MM * 0.4);
    expect(pages[1].lines[0].text).toBe("Los.");
  });

  it("breaks onto further pages for long scripts", () => {
    const blocks: ExtractedBlock[] = [];
    for (let i = 0; i < 60; i++) {
      blocks.push(block("character", i % 2 ? "Timo" : "Axel"));
      blocks.push(block("dialog", "Ein Satz, der ungefähr eine Zeile lang ist und dann weitergeht."));
    }
    const pages = layoutPdfPreview({ ...base, blocks });
    expect(pages.length).toBeGreaterThan(3);
    for (const p of pages) {
      for (const l of p.lines) expect(l.baselineMm).toBeLessThanOrEqual(A4_H_MM - 25 + 0.001);
    }
  });

  it("keeps a character cue together with its dialog (widow guard)", () => {
    const blocks: ExtractedBlock[] = [];
    for (let i = 0; i < 80; i++) {
      blocks.push(block("character", "Timo"));
      blocks.push(block("dialog", "Kurz."));
    }
    const pages = layoutPdfPreview({ ...base, blocks });
    for (const p of pages) {
      const last = p.lines[p.lines.length - 1];
      expect(last.text).not.toBe("TIMO");
    }
  });

  it("returns one empty page for an empty script", () => {
    const pages = layoutPdfPreview({ ...base, blocks: [] });
    expect(pages).toHaveLength(1);
    expect(pages[0].lines).toHaveLength(0);
  });
});
