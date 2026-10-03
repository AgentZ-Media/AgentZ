import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import { afterEach, expect, it, vi } from "vitest";
import regularUrl from "../../assets/fonts/iAWriterQuattroS-Regular.ttf?url";
import boldUrl from "../../assets/fonts/iAWriterQuattroS-Bold.ttf?url";
import italicUrl from "../../assets/fonts/iAWriterQuattroS-Italic.ttf?url";
import boldItalicUrl from "../../assets/fonts/iAWriterQuattroS-BoldItalic.ttf?url";
import { buildPdfBytes } from "../exportPdf";

afterEach(() => vi.unstubAllGlobals());

it("builds an A4 PDF with all four module-owned font styles", async () => {
  const fonts = new Map([
    [regularUrl, "Regular"],
    [boldUrl, "Bold"],
    [italicUrl, "Italic"],
    [boldItalicUrl, "BoldItalic"],
  ]);
  const fetchFont = vi.fn(async (url: string) => {
    const style = fonts.get(url);
    if (!style) throw new Error(`Unexpected font URL: ${url}`);
    const fontPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/fonts", `iAWriterQuattroS-${style}.ttf`);
    const bytes = await readFile(fontPath);
    return { ok: true, arrayBuffer: async () => Uint8Array.from(bytes).buffer };
  });
  vi.stubGlobal("fetch", fetchFont);

  const bytes = await buildPdfBytes({
    title: "Module font export",
    characters: [],
    contentJson: JSON.stringify({ root: { children: [{
      type: "scriptz-action",
      children: [0, 1, 2, 3].map((format) => ({
        type: "text", text: `Font style ${format}. `, format,
      })),
    }] } }),
  }, { includeHighlighting: false, includeTitlePage: false });

  expect(fetchFont).toHaveBeenCalledTimes(4);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getTitle()).toBe("Module font export");
  expect(doc.getPageCount()).toBe(1);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 2);
  expect(doc.getPage(0).getHeight()).toBeCloseTo(841.89, 2);
  const pdf = new TextDecoder().decode(bytes);
  for (const style of fonts.values()) {
    expect(pdf).toContain(`/BaseFont /iAWriterQuattroS-${style}`);
  }
});
