// PDF generator - browser-compatible byte generation.
//
// Pure layout logic on pdf-lib + @pdf-lib/fontkit without a Tauri binding.
// Writing the file is the platform adapter's job (`saveAs`).
//
// Layout conventions: A4 geometry, iA Writer Quattro S TTF/11pt,
// tint-band highlighting. Changes to the geometry must be aligned with the
// editor look, otherwise the export and preview diverge.
//
// Font assets belong to the product module. Vite resolves their URLs
// for both the dev server and the bundled desktop application.

import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import regularFontUrl from "../assets/fonts/iAWriterQuattroS-Regular.ttf?url";
import boldFontUrl from "../assets/fonts/iAWriterQuattroS-Bold.ttf?url";
import italicFontUrl from "../assets/fonts/iAWriterQuattroS-Italic.ttf?url";
import boldItalicFontUrl from "../assets/fonts/iAWriterQuattroS-BoldItalic.ttf?url";
import { extractBlocks, type TextRun } from "./lex";
import { tintKindOf, tintSpeakers } from "./tint";
import { pdfPageLabel } from "./pdfDetails";
import type { ScriptCharacter } from "./types";

export interface ExportPdfDeps {
  title: string;
  contentJson: string;
  characters: ScriptCharacter[];
}
import { t } from "../i18n";

// ---- Geometry (mm) ----
const A4_W_MM = 210.0;
const A4_H_MM = 297.0;
const MARGIN_TOP_MM = 25.0;
const MARGIN_BOTTOM_MM = 25.0;
const MARGIN_LEFT_MM = 27.0;
const MARGIN_RIGHT_MM = 27.0;
const FONT_SIZE_PT = 11.0;
const LINE_HEIGHT_MM = 6.2;
const PARA_GAP_MM = 1.6;
const CHAR_W_MM = 2.3; // duospaced glyph advance at 11pt

// Tint-band geometry (per-line band).
// Values aligned with the CSS pill in the editor (`padding: 1px 4px`,
// `border-radius: 3px`): horizontally about 4 px padding, vertically such
// that the cap height of the glyphs is fully enclosed. PDF baseline
// sits at the lower glyph edge - so we need significantly more
// offset on top than on the bottom, otherwise the letters poke out at the top.
const TINT_PAD_X_MM = 1.1;
const TINT_TOP_OFFSET_MM = 3.6;
const TINT_BOTTOM_OFFSET_MM = 1.4;
const TINT_RADIUS_MM = 1.2;
const TINT_ALPHA_FACTOR = 0.28;

// 1 mm in PDF-Punkten (1pt = 1/72 inch, 1 inch = 25.4 mm).
const MM_TO_PT = 72 / 25.4;
const mm = (v: number) => v * MM_TO_PT;

const A4_W_PT = mm(A4_W_MM);
const A4_H_PT = mm(A4_H_MM);

let cachedFontBytes: {
  regular: Uint8Array;
  bold: Uint8Array;
  italic: Uint8Array;
  boldItalic: Uint8Array;
} | null = null;

async function loadFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  const [regular, bold, italic, boldItalic] = await Promise.all([
    fetchFont(regularFontUrl),
    fetchFont(boldFontUrl),
    fetchFont(italicFontUrl),
    fetchFont(boldItalicFontUrl),
  ]);
  cachedFontBytes = { regular, bold, italic, boldItalic };
  return cachedFontBytes;
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`font fetch ${url}: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

class Layout {
  doc: PDFDocument;
  fonts: Fonts;
  page: PDFPage;
  // y in mm, top-down. Converted
  // to pt when drawing. PDF origin is bottom-left, so y_pt = mm(y_mm).
  y_mm: number;

  constructor(doc: PDFDocument, fonts: Fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = doc.addPage([A4_W_PT, A4_H_PT]);
    this.y_mm = A4_H_MM - MARGIN_TOP_MM;
  }

  newPage() {
    this.page = this.doc.addPage([A4_W_PT, A4_H_PT]);
    this.y_mm = A4_H_MM - MARGIN_TOP_MM;
  }

  ensureSpace(neededMm: number) {
    if (this.y_mm - neededMm < MARGIN_BOTTOM_MM) {
      this.newPage();
    }
  }

  fontFor(italic: boolean, bold: boolean): PDFFont {
    if (italic && bold) return this.fonts.boldItalic;
    if (italic) return this.fonts.italic;
    if (bold) return this.fonts.bold;
    return this.fonts.regular;
  }

  writeLine(
    text: string,
    xLeftMm: number,
    widthMm: number,
    italic: boolean,
    bold: boolean,
    align: "left" | "center" | "right",
    tint: [number, number, number] | null,
    runs?: TextRun[],
    transform?: (s: string) => string,
  ) {
    const charsPerLine = Math.max(20, Math.trunc(widthMm / CHAR_W_MM));
    const hasInlineFormat = !!runs && runs.some((r) => r.bold || r.italic || r.underline);

    // Fast path: no inline format → render the plain text as before.
    // Avoids the tokenizer's overhead for the 95% case where a block has
    // a single uniform run.
    if (!hasInlineFormat) {
      const plain = transform ? transform(text) : text;
      const lines = simpleWrap(plain, charsPerLine);
      const font = this.fontFor(italic, bold);
      for (const line of lines) {
        this.ensureSpace(LINE_HEIGHT_MM);
        const lineWMm = font.widthOfTextAtSize(line, FONT_SIZE_PT) / MM_TO_PT;
        const xPos = alignX(xLeftMm, widthMm, lineWMm, align);

        if (tint && line.trim().length > 0) {
          this.drawTintPill(xPos, lineWMm, tint);
        }
        this.page.drawText(line, {
          x: mm(xPos),
          y: mm(this.y_mm),
          font,
          size: FONT_SIZE_PT,
          color: rgb(0, 0, 0),
        });
        this.y_mm -= LINE_HEIGHT_MM;
      }
      this.y_mm -= PARA_GAP_MM;
      return;
    }

    // Rich path: wrap runs, then render each line as a sequence of
    // (font, text) pieces with the tint pill spanning the whole line.
    const xformed = transform ? runs!.map((r) => ({ ...r, text: transform(r.text) })) : runs!;
    const tokens = tokenize(xformed);
    const lines = wrapTokens(tokens, charsPerLine);

    for (const line of lines) {
      this.ensureSpace(LINE_HEIGHT_MM);

      // Total width: sum each piece using its own font (bold/italic glyphs
      // are slightly wider, so summing under the base font would clip the tint).
      let lineWMm = 0;
      for (const piece of line) {
        const f = this.fontFor(italic || piece.italic, bold || piece.bold);
        lineWMm += f.widthOfTextAtSize(piece.text, FONT_SIZE_PT) / MM_TO_PT;
      }
      const trimmedLen = line.reduce((n, p) => n + p.text.length, 0);
      const xPos = alignX(xLeftMm, widthMm, lineWMm, align);

      if (tint && trimmedLen > 0 && line.some((p) => p.text.trim().length > 0)) {
        this.drawTintPill(xPos, lineWMm, tint);
      }

      let cx = xPos;
      for (const piece of line) {
        const f = this.fontFor(italic || piece.italic, bold || piece.bold);
        const pieceWMm = f.widthOfTextAtSize(piece.text, FONT_SIZE_PT) / MM_TO_PT;
        this.page.drawText(piece.text, {
          x: mm(cx),
          y: mm(this.y_mm),
          font: f,
          size: FONT_SIZE_PT,
          color: rgb(0, 0, 0),
        });
        cx += pieceWMm;
      }

      this.y_mm -= LINE_HEIGHT_MM;
    }
    this.y_mm -= PARA_GAP_MM;
  }

  drawTintPill(xPos: number, lineWMm: number, tint: [number, number, number]) {
    const rectX1 = xPos - TINT_PAD_X_MM;
    const rectX2 = xPos + lineWMm + TINT_PAD_X_MM;
    const rectTop = this.y_mm + TINT_TOP_OFFSET_MM;
    const rectBottom = this.y_mm - TINT_BOTTOM_OFFSET_MM;
    const [r, g, b] = tint;
    const wPt = mm(rectX2 - rectX1);
    const hPt = mm(rectTop - rectBottom);
    const rPt = mm(TINT_RADIUS_MM);
    this.page.drawSvgPath(roundedRectPath(wPt, hPt, rPt), {
      x: mm(rectX1),
      y: mm(rectTop),
      color: rgb(r / 255, g / 255, b / 255),
      borderWidth: 0,
    });
  }
}

function alignX(xLeftMm: number, widthMm: number, contentWMm: number, align: "left" | "center" | "right"): number {
  if (align === "center") return xLeftMm + (widthMm - contentWMm) / 2.0;
  if (align === "right") return xLeftMm + widthMm - contentWMm;
  return xLeftMm;
}

interface Piece {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}
type Token =
  | { kind: "word"; piece: Piece }
  | { kind: "space"; piece: Piece }
  | { kind: "newline" };

/** Break runs into word / whitespace / newline tokens. Each word keeps the
 *  formatting of its source run, which means a half-bolded word (rare —
 *  inline format usually snaps to word boundaries) becomes two adjacent
 *  word tokens that render seamlessly because there is no space between them. */
function tokenize(runs: TextRun[]): Token[] {
  const out: Token[] = [];
  for (const r of runs) {
    const lines = r.text.split("\n");
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) out.push({ kind: "newline" });
      const piece = (text: string): Piece => ({
        text,
        bold: r.bold,
        italic: r.italic,
        underline: r.underline,
      });
      const parts = lines[li].match(/\S+|\s+/g) ?? [];
      for (const p of parts) {
        const isSpace = /^\s+$/.test(p);
        out.push({ kind: isSpace ? "space" : "word", piece: piece(p) });
      }
    }
  }
  return out;
}

/** Word-wrap tokens by char count (mirrors simpleWrap's width metric),
 *  collapsing runs of whitespace to a single space — same rule the
 *  existing simpleWrap uses, so wrap points stay aligned with the plain
 *  text path. */
function wrapTokens(tokens: Token[], width: number): Piece[][] {
  const lines: Piece[][] = [];
  let cur: Piece[] = [];
  let curLen = 0;

  const flush = () => {
    while (cur.length > 0 && cur[cur.length - 1].text === " ") cur.pop();
    lines.push(cur);
    cur = [];
    curLen = 0;
  };

  for (const tok of tokens) {
    if (tok.kind === "newline") {
      flush();
      continue;
    }
    if (tok.kind === "space") {
      // Collapse to one space and only emit when there's already content.
      if (cur.length > 0 && curLen + 1 <= width) {
        cur.push({ ...tok.piece, text: " " });
        curLen += 1;
      }
      continue;
    }
    const w = countChars(tok.piece.text);
    if (cur.length === 0) {
      cur.push(tok.piece);
      curLen = w;
    } else if (curLen + w > width) {
      flush();
      cur.push(tok.piece);
      curLen = w;
    } else {
      cur.push(tok.piece);
      curLen += w;
    }
  }
  if (cur.length > 0) {
    flush();
  } else if (lines.length === 0) {
    lines.push([]);
  }
  return lines;
}

// Rounded-rect SVG path for the tint pill. SVG coordinates are
// y-down; pdf-lib's drawSvgPath flips them on render, so we draw
// here "top to bottom" and pass the top edge as the
// y position. Radius is clamped to half the width/height so
// short pills (e.g. a single letter) don't collapse.
function roundedRectPath(wPt: number, hPt: number, rPt: number): string {
  const r = Math.min(rPt, wPt / 2, hPt / 2);
  return (
    `M ${r} 0 ` +
    `H ${wPt - r} ` +
    `A ${r} ${r} 0 0 1 ${wPt} ${r} ` +
    `V ${hPt - r} ` +
    `A ${r} ${r} 0 0 1 ${wPt - r} ${hPt} ` +
    `H ${r} ` +
    `A ${r} ${r} 0 0 1 0 ${hPt - r} ` +
    `V ${r} ` +
    `A ${r} ${r} 0 0 1 ${r} 0 ` +
    `Z`
  );
}

function countChars(s: string): number {
  // Counts Unicode scalars, mirrors Rust `chars().count()`.
  let n = 0;
  for (const _ of s) n++;
  return n;
}

// Mirrors Rust `simple_wrap`: splits at '\n', then whitespace wrap
// by char count. Empty chunks emit an empty line; an empty
// input still yields one empty line.
function simpleWrap(text: string, width: number): string[] {
  const out: string[] = [];
  const chunks = text.split("\n");
  for (const chunk of chunks) {
    if (chunk.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    const words = chunk.split(/\s+/u).filter((w) => w.length > 0);
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (countChars(line) + 1 + countChars(word) > width) {
        out.push(line);
        line = word;
      } else {
        line = line + " " + word;
      }
    }
    out.push(line);
  }
  if (out.length === 0) out.push("");
  return out;
}

// Lightens RGB hex toward white by `(1 - alphaFactor)`. Mirrors
// Rust `hex_to_rgb_tint(hex, 0.28)`.
function hexToRgbTint(hex: string, alphaFactor: number): [number, number, number] {
  // Neutral grey fallback for any malformed hex. Rust had two
  // different greys here (240,240,240 vs 160,160,160) - merged into one
  // here because both paths are dead in practice (character
  // colors come from DEFAULT_PALETTE, always well-formed).
  const FALLBACK: [number, number, number] = [160, 160, 160];
  const s = hex.startsWith("#") ? hex.slice(1) : hex;
  if (s.length !== 6) return FALLBACK;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return FALLBACK;
  const mix = (c: number) =>
    Math.max(0, Math.min(255, Math.round(255 - (255 - c) * alphaFactor)));
  return [mix(r), mix(g), mix(b)];
}

export interface BuildPdfBytesOptions {
  includeHighlighting: boolean;
  includeTitlePage: boolean;
  /** Detail line under the cast on the title page (folder, runtime, date,
   *  see lib/pdfDetails.ts). */
  titleDetails?: string | null;
}

// Page footer: small, grey, centred in the bottom margin.
const FOOTER_SIZE_PT = 8.5;
const FOOTER_Y_MM = MARGIN_BOTTOM_MM / 2;

/** Generates the finished PDF bytes for a script. Pure function -
 *  caller decides what happens with the bytes through the host adapter. */
export async function buildPdfBytes(
  deps: ExportPdfDeps,
  opts: BuildPdfBytesOptions,
): Promise<Uint8Array> {
  const fontBytes = await loadFontBytes();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(deps.title);

  const [regular, bold, italic, boldItalic] = await Promise.all([
    doc.embedFont(fontBytes.regular, { subset: true }),
    doc.embedFont(fontBytes.bold, { subset: true }),
    doc.embedFont(fontBytes.italic, { subset: true }),
    doc.embedFont(fontBytes.boldItalic, { subset: true }),
  ]);

  const layout = new Layout(doc, { regular, bold, italic, boldItalic });

  if (opts.includeTitlePage) {
    layout.y_mm = A4_H_MM * 0.6;
    layout.writeLine(
      deps.title,
      MARGIN_LEFT_MM,
      A4_W_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM,
      false,
      true,
      "center",
      null,
    );
    if (deps.characters.length > 0) {
      const names = deps.characters.map((c) => c.name);
      const line = t("export.pdf.characters", { names: names.join(", ") });
      layout.writeLine(
        line,
        MARGIN_LEFT_MM,
        A4_W_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM,
        true,
        false,
        "center",
        null,
      );
    }
    if (opts.titleDetails) {
      layout.writeLine(
        opts.titleDetails,
        MARGIN_LEFT_MM,
        A4_W_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM,
        false,
        false,
        "center",
        null,
      );
    }
    layout.newPage();
  }

  const contentW = A4_W_MM - MARGIN_LEFT_MM - MARGIN_RIGHT_MM;
  // Four block types (Action, Character, Dialog, Parenthetical). Retired
  // types arrive as action - extractBlocks normalizes them via
  // lib/legacyBlocks.ts.
  const blocks = extractBlocks(deps.contentJson);

  // Same tint rule as the editor and the preview (lib/tint.ts).
  const speakers = tintSpeakers(blocks.map((block) => ({ kind: tintKindOf(block.kind), text: block.text })));
  // name (UPPER) -> color hex
  const charColor = new Map<string, string>();
  for (const c of deps.characters) {
    charColor.set(c.name.toUpperCase(), c.color);
  }

  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];

    // Widow/orphan guard for character speech: reserve 4 lines + 2
    // paragraph gaps so a character block doesn't end up orphaned
    // at the page bottom.
    if (b.kind === "scriptz-character") {
      layout.ensureSpace(LINE_HEIGHT_MM * 4 + PARA_GAP_MM * 2);
    }

    const tint = computeTint(speakers[idx], opts.includeHighlighting, charColor);

    const upper = (s: string) => s.toUpperCase();
    switch (b.kind) {
      case "scriptz-character":
        layout.writeLine(
          b.text.toUpperCase(),
          MARGIN_LEFT_MM,
          contentW,
          false,
          true,
          "center",
          tint,
          b.runs,
          upper,
        );
        break;
      case "scriptz-dialog":
        layout.writeLine(
          b.text,
          MARGIN_LEFT_MM + 25.0,
          contentW - 50.0,
          false,
          false,
          "left",
          tint,
          b.runs,
        );
        break;
      case "scriptz-parenthetical":
        // The parentheticalLive plugin already wraps text in "( … )" -
        // render verbatim so it isn't doubly parenthesized.
        layout.writeLine(
          b.text,
          MARGIN_LEFT_MM + 35.0,
          contentW - 70.0,
          true,
          false,
          "left",
          tint,
          b.runs,
        );
        break;
      case "scriptz-action":
        layout.writeLine(
          b.text,
          MARGIN_LEFT_MM,
          contentW,
          false,
          false,
          "left",
          null,
          b.runs,
        );
        break;
      default:
        layout.writeLine(
          b.text,
          MARGIN_LEFT_MM,
          contentW,
          false,
          false,
          "left",
          null,
          b.runs,
        );
    }
  }

  // Page numbers on every content page ("Seite 2 von 3"); the title page
  // has none and does not count.
  const pages = doc.getPages();
  const first = opts.includeTitlePage ? 1 : 0;
  const total = pages.length - first;
  for (let i = first; i < pages.length; i++) {
    const label = pdfPageLabel(i - first + 1, total);
    const width = regular.widthOfTextAtSize(label, FOOTER_SIZE_PT);
    pages[i].drawText(label, {
      x: (A4_W_PT - width) / 2,
      y: mm(FOOTER_Y_MM),
      font: regular,
      size: FOOTER_SIZE_PT,
      color: rgb(0.45, 0.45, 0.45),
    });
  }

  return await doc.save({ useObjectStreams: false });
}

function computeTint(
  speaker: string | null,
  includeHighlighting: boolean,
  charColor: Map<string, string>,
): [number, number, number] | null {
  if (!includeHighlighting || speaker === null) return null;
  const hex = charColor.get(speaker);
  if (!hex) return null;
  return hexToRgbTint(hex, TINT_ALPHA_FACTOR);
}
