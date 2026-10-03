// HTML preview layout for the export dialog: computes where every line of
// the PDF lands, page by page, so the dialog can render page 1 and say how
// many pages the PDF will have - without loading pdf-lib (~1 MB).
//
// Mirrors the geometry and wrapping rules of lib/exportPdf.ts (A4, iA
// Writer Quattro 11 pt, char-count wrapping, widow guard for character
// cues, title page). Keep the constants below in sync with that file -
// the preview is only honest as long as both agree.

import type { ExtractedBlock } from "../../lib/lex";
import type { ScriptCharacter } from "../../lib/types";

export const A4_W_MM = 210;
export const A4_H_MM = 297;
const MARGIN_TOP_MM = 25;
const MARGIN_BOTTOM_MM = 25;
const MARGIN_LEFT_MM = 27;
const MARGIN_RIGHT_MM = 27;
export const LINE_HEIGHT_MM = 6.2;
const PARA_GAP_MM = 1.6;
const CHAR_W_MM = 2.3;
/** 11 pt in mm - the PDF's font size. */
export const FONT_SIZE_MM = (11 / 72) * 25.4;
const DIALOG_INSET_MM = 25;
const PAREN_INSET_MM = 35;

export interface PreviewLine {
  text: string;
  /** Left edge and width of the text column in mm. */
  xMm: number;
  widthMm: number;
  /** Baseline distance from the top edge of the page in mm. */
  baselineMm: number;
  align: "left" | "center";
  bold: boolean;
  italic: boolean;
  /** Character colour ("#rrggbb") for the tint band, or null. */
  tint: string | null;
}

export interface PreviewPage {
  lines: PreviewLine[];
}

export interface PreviewInput {
  title: string;
  blocks: ExtractedBlock[];
  characters: ScriptCharacter[];
  includeHighlighting: boolean;
  includeTitlePage: boolean;
  /** Pre-translated cast line for the title page ("Charaktere: A, B"). */
  castLine: string | null;
}

function countChars(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Same rule as exportPdf's simpleWrap: split at "\n", then greedy
 *  whitespace wrap by character count; empty chunks become empty lines. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const chunk of text.split("\n")) {
    if (chunk.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of chunk.split(/\s+/u).filter((w) => w.length > 0)) {
      if (line.length === 0) line = word;
      else if (countChars(line) + 1 + countChars(word) > width) {
        out.push(line);
        line = word;
      } else line = `${line} ${word}`;
    }
    out.push(line);
  }
  if (out.length === 0) out.push("");
  return out;
}

function tintFor(
  blocks: ExtractedBlock[],
  idx: number,
  colors: Map<string, string>,
): string | null {
  const b = blocks[idx];
  if (
    b.kind !== "scriptz-character" &&
    b.kind !== "scriptz-dialog" &&
    b.kind !== "scriptz-parenthetical"
  ) {
    return null;
  }
  let name: string | null = b.kind === "scriptz-character" ? b.text.trim().toUpperCase() : null;
  if (name === null) {
    for (let j = idx - 1; j >= 0; j--) {
      if (blocks[j].kind === "scriptz-character") {
        name = blocks[j].text.trim().toUpperCase();
        break;
      }
    }
  }
  if (name === null) return null;
  return colors.get(name) ?? null;
}

export function layoutPdfPreview(input: PreviewInput): PreviewPage[] {
  const pages: PreviewPage[] = [{ lines: [] }];
  // y measured from the bottom edge, like the PDF generator.
  let y = A4_H_MM - MARGIN_TOP_MM;
  const page = () => pages[pages.length - 1];
  const newPage = () => {
    pages.push({ lines: [] });
    y = A4_H_MM - MARGIN_TOP_MM;
  };
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN_BOTTOM_MM) newPage();
  };
  const contentW = A4_W_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM;

  const writeLine = (
    text: string,
    xMm: number,
    widthMm: number,
    align: "left" | "center",
    bold: boolean,
    italic: boolean,
    tint: string | null,
  ) => {
    const perLine = Math.max(20, Math.trunc(widthMm / CHAR_W_MM));
    for (const line of wrapText(text, perLine)) {
      ensureSpace(LINE_HEIGHT_MM);
      page().lines.push({
        text: line,
        xMm,
        widthMm,
        baselineMm: A4_H_MM - y,
        align,
        bold,
        italic,
        tint: tint && line.trim().length > 0 ? tint : null,
      });
      y -= LINE_HEIGHT_MM;
    }
    y -= PARA_GAP_MM;
  };

  if (input.includeTitlePage) {
    y = A4_H_MM * 0.6;
    writeLine(input.title, MARGIN_LEFT_MM, contentW, "center", true, false, null);
    if (input.castLine) writeLine(input.castLine, MARGIN_LEFT_MM, contentW, "center", false, true, null);
    newPage();
  }

  const colors = new Map<string, string>();
  if (input.includeHighlighting) {
    for (const c of input.characters) colors.set(c.name.toUpperCase(), c.color);
  }

  input.blocks.forEach((b, idx) => {
    if (b.kind === "scriptz-character") ensureSpace(LINE_HEIGHT_MM * 4 + PARA_GAP_MM * 2);
    const tint = input.includeHighlighting ? tintFor(input.blocks, idx, colors) : null;
    if (b.kind === "scriptz-character") {
      writeLine(b.text.toUpperCase(), MARGIN_LEFT_MM, contentW, "center", true, false, tint);
    } else if (b.kind === "scriptz-dialog") {
      writeLine(b.text, MARGIN_LEFT_MM + DIALOG_INSET_MM, contentW - 2 * DIALOG_INSET_MM, "left", false, false, tint);
    } else if (b.kind === "scriptz-parenthetical") {
      // Verbatim like the PDF: the text already carries its "( … )".
      writeLine(b.text, MARGIN_LEFT_MM + PAREN_INSET_MM, contentW - 2 * PAREN_INSET_MM, "left", false, true, tint);
    } else {
      writeLine(b.text, MARGIN_LEFT_MM, contentW, "left", false, false, null);
    }
  });

  return pages;
}
