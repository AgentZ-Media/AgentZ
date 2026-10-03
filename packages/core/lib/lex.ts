// Lexical state -> plain text extraction independent of the renderer.
//
// Lossy on purpose - feeds FTS5 and the plain-text export, NOT round-trip
// rendering.
//
// Retired block types (camera, caption, sfx) are converted to action
// blocks before extraction (see ./legacyBlocks.ts), so every consumer -
// FTS, exports, word counts, runtime, character reconciliation - sees the
// same four block types as the editor (action, character, dialog,
// parenthetical).

import { mayContainLegacyBlocks, normalizeLegacyTree } from "./legacyBlocks";

/** A contiguous text fragment with uniform inline formatting.
 *  Mirrors Lexical's per-TextNode `format` bitfield: bit 0 = bold,
 *  bit 1 = italic, bit 3 = underline. Linebreaks are flattened into
 *  `\n` inside `text`. */
export interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface ExtractedBlock {
  kind: string;
  text: string;
  /** Per-character formatting, preserved so the PDF can render bold/italic
   *  spans inside a dialog without losing the character tint. Always present;
   *  for unformatted text it contains a single run with all three flags false. */
  runs: TextRun[];
}

const FORMAT_BOLD = 1;
const FORMAT_ITALIC = 2;
const FORMAT_UNDERLINE = 8;

const SCRIPTZ_KINDS = new Set([
  "scriptz-action",
  "scriptz-character",
  "scriptz-dialog",
  "scriptz-parenthetical",
]);

export function extractBlocks(contentJson: string): ExtractedBlock[] {
  let v: unknown;
  try {
    v = JSON.parse(contentJson);
  } catch {
    return [];
  }
  if (mayContainLegacyBlocks(contentJson)) normalizeLegacyTree(v);
  const root = isObject(v) && "root" in v ? (v as Record<string, unknown>).root : v;
  const out: ExtractedBlock[] = [];
  walk(root, out);
  return out;
}

function walk(node: unknown, out: ExtractedBlock[]): void {
  if (!isObject(node)) return;
  const typ = node.type;
  if (typeof typ === "string" && SCRIPTZ_KINDS.has(typ)) {
    const runs = collectRuns(node);
    const text = runs.map((r) => r.text).join("");
    out.push({ kind: typ, text, runs: mergeRuns(runs) });
    return;
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, out);
  }
}

function collectRuns(node: unknown): TextRun[] {
  const buf: TextRun[] = [];
  collectRunsInto(node, buf);
  if (buf.length === 0) buf.push({ text: "", bold: false, italic: false, underline: false });
  return buf;
}

function collectRunsInto(node: unknown, buf: TextRun[]): void {
  if (!isObject(node)) return;
  const t = node.type;
  if (typeof t === "string") {
    if (t === "linebreak") {
      buf.push({ text: "\n", bold: false, italic: false, underline: false });
      return;
    }
    if (t === "text") {
      const text = node.text;
      if (typeof text === "string") {
        const fmt = typeof node.format === "number" ? node.format : 0;
        buf.push({
          text,
          bold: (fmt & FORMAT_BOLD) !== 0,
          italic: (fmt & FORMAT_ITALIC) !== 0,
          underline: (fmt & FORMAT_UNDERLINE) !== 0,
        });
      }
      return;
    }
  }
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) collectRunsInto(child, buf);
  }
}

/** Coalesce adjacent runs with identical formatting so downstream code
 *  doesn't draw a font switch for what is logically one span. */
function mergeRuns(runs: TextRun[]): TextRun[] {
  if (runs.length <= 1) return runs;
  const out: TextRun[] = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i++) {
    const last = out[out.length - 1];
    const cur = runs[i];
    if (last.bold === cur.bold && last.italic === cur.italic && last.underline === cur.underline) {
      last.text += cur.text;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function extractPlainText(contentJson: string): string {
  const blocks = extractBlocks(contentJson);
  let out = "";
  for (const b of blocks) {
    if (out.length > 0) out += "\n\n";
    switch (b.kind) {
      case "scriptz-character":
        out += b.text.toUpperCase();
        break;
      case "scriptz-parenthetical":
        out += "(" + trimParens(b.text.trim()) + ")";
        break;
      default:
        out += b.text;
    }
  }
  return out;
}

export function extractTeleprompterText(contentJson: string): string {
  // Plain-text (teleprompter) export: only Character, Dialog and
  // Parenthetical. Parentheticals are always written as "( … )", whether
  // the block text already carries the parentheses (typed live with "(")
  // or not (set via ⌘4).
  const blocks = extractBlocks(contentJson);
  let out = "";
  for (const b of blocks) {
    switch (b.kind) {
      case "scriptz-character":
        if (out.length > 0) out += "\n\n";
        out += b.text.toUpperCase();
        break;
      case "scriptz-dialog":
        if (out.length > 0) out += "\n";
        out += b.text;
        break;
      case "scriptz-parenthetical": {
        if (out.length > 0) out += "\n";
        out += "(" + trimParens(b.text.trim()) + ")";
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/**
 * Word-token set for similarity comparison. Lowercased, ASCII-stripped of
 * punctuation, ignores tokens shorter than 3 chars (drops "im", "am", "und"
 * etc. that would dominate a Jaccard score). NOT meant for FTS - that's what
 * `extractPlainText` feeds.
 */
export function wordTokenSet(text: string): Set<string> {
  const out = new Set<string>();
  // Mirrors Rust's `c.is_alphanumeric()` (Unicode Alphabetic | Numeric).
  const parts = text.split(/[^\p{Alphabetic}\p{N}]+/u);
  for (const raw of parts) {
    if (raw.length === 0) continue;
    const token = raw.toLowerCase();
    // Count Unicode scalar values, not UTF-16 code units, to mirror
    // Rust's `chars().count() >= 3`.
    if (codePointCount(token) >= 3) out.add(token);
  }
  return out;
}

/**
 * Jaccard similarity between two word-token sets, in [0.0, 1.0].
 * Two empty sets are defined as fully similar (1.0) - no content, no diff.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1.0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  if (union === 0) return 1.0;
  return inter / union;
}

/** Dialog words per character - same algorithm as the Inspector cast
 *  shares: words from `scriptz-dialog` blocks are assigned to the
 *  most recently preceding `scriptz-character` block (parenthetical
 *  words are delivery cues and don't count). Characters
 *  without dialog have an entry of `0` (so callers know
 *  they exist). Keys are UPPERCASE because character names
 *  match case-insensitively app-wide.
 *
 *  Single source of truth for this calculation - see `scripts.ts`
 *  (for `characters_meta.share` on save); the live Inspector mirrors it
 *  in `components/Script/timelineMath.ts::liveStats`. */
export function dialogWordsByCharacter(contentJson: string): Record<string, number> {
  const out: Record<string, number> = {};
  let last: string | null = null;
  for (const b of extractBlocks(contentJson)) {
    if (b.kind === "scriptz-character") {
      last = b.text.trim().toUpperCase();
      if (last && !(last in out)) out[last] = 0;
    } else if (b.kind === "scriptz-dialog" && last) {
      const w = b.text.trim().split(/\s+/).filter(Boolean).length;
      out[last] = (out[last] ?? 0) + w;
    }
  }
  return out;
}

/** Collect unique character names (uppercase) used in the script's content. */
export function extractCharacterNames(contentJson: string): string[] {
  const blocks = extractBlocks(contentJson);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind !== "scriptz-character") continue;
    const name = b.text.trim().toUpperCase();
    if (name.length === 0) continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// ---------- helpers ----------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Mirrors `b.text.trim_matches(|c| c == '(' || c == ')')`: strip ALL
// leading/trailing parens (not just one pair).
function trimParens(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && (s[start] === "(" || s[start] === ")")) start++;
  while (end > start && (s[end - 1] === "(" || s[end - 1] === ")")) end--;
  return s.slice(start, end);
}

function codePointCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
