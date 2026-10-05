// Which character colour tints which block - one rule for the editor
// (components/Editor/plugins/highlight.ts), the PDF (lib/exportPdf.ts) and
// the export preview (components/Export/pdfPreview.ts), so the paper and
// the printout always look the same.
//
// A character block is tinted with its own colour; dialog and
// parenthetical blocks keep the colour of the character above them. An
// action block ends the speech run: a dialog after stage directions
// without a new character line stays untinted.
//
// Tinting is about the paper only. Who a line is attributed to for word
// counts and the timeline (lib/lex.ts, lib/timing.ts) is a separate rule.

export type TintKind = "character" | "dialog" | "paren" | "other";

/** Maps a Lexical / extracted block type onto the tint rule. */
export function tintKindOf(type: string): TintKind {
  if (type === "scriptz-character") return "character";
  if (type === "scriptz-dialog") return "dialog";
  if (type === "scriptz-parenthetical") return "paren";
  return "other";
}

/** Upper-cased speaker whose colour tints each block (null = no tint). */
export function tintSpeakers(blocks: ReadonlyArray<{ kind: TintKind; text: string }>): (string | null)[] {
  const out: (string | null)[] = [];
  let current: string | null = null;
  for (const block of blocks) {
    if (block.kind === "character") {
      const name = block.text.trim().toUpperCase();
      current = name || null;
      out.push(current);
    } else if (block.kind === "dialog" || block.kind === "paren") {
      out.push(current);
    } else {
      current = null;
      out.push(null);
    }
  }
  return out;
}
