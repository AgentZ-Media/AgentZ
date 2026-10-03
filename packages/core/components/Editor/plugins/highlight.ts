// Per-character tint for Charakter / Dialog blocks.
//
// CLAUDE.md is strict about not mutating Lexical text-node state during
// keystrokes — but applying a CSS custom property on the rendered DOM
// element (no Lexical state changes, no transforms) is safe. This plugin
// runs after every reconcile and writes `--char-tint` onto the DOM
// element of any block whose effective speaker has a known palette
// colour. The Editor.css rule paints `background: var(--char-tint, …)`
// when `data-highlighting="on"` is set on the editor root.
//
// PDF export does the equivalent walk in TS (see src/lib/exportPdf.ts,
// `computeTint` + `hexToRgbTint`). This brings the live editor in line
// with the rendered output the user sees on save/share.

import type { LexicalEditor } from "lexical";
import { $getRoot } from "lexical";
import { $isScriptzCharacterNode } from "../nodes";
import type { ScriptCharacter } from "../../../lib/types";
import { isParenCueText } from "../../../lib/lex";

const TINT_BLOCKS = new Set(["scriptz-character", "scriptz-dialog"]);

/** Fallback paper colours if the `--paper` token can't be read (tests,
 *  SSR). Light = the PDF paper; dark = the design system's dark paper. */
const LIGHT_PAPER: [number, number, number] = [255, 255, 255];
const DARK_PAPER: [number, number, number] = [30, 33, 39];

/** Mix "#rrggbb" onto the paper colour at `alpha` (0..1) -> "rgb(r,g,b)".
 * On white paper this is exactly the PDF formula in exportPdf.ts
 * (255 - (255 - c) * alpha), so editor and PDF look identical. On dark
 * paper the colour is mixed toward the dark sheet instead, so text stays
 * readable and nothing turns grey. */
function hexToTint(hex: string, alpha: number, paper: [number, number, number]): string {
  const rgb = parseHex(hex);
  if (!rgb) return "";
  const mix = (c: number, p: number) => Math.round(p + (c - p) * alpha);
  return `rgb(${mix(rgb[0], paper[0])}, ${mix(rgb[1], paper[1])}, ${mix(rgb[2], paper[2])})`;
}

/** The current paper colour from the `--paper` design token. */
function currentPaper(): [number, number, number] {
  if (typeof document === "undefined") return LIGHT_PAPER;
  const dark = document.documentElement.dataset.paper === "dark";
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--paper").trim();
  return parseHex(raw) ?? (dark ? DARK_PAPER : LIGHT_PAPER);
}

function parseHex(hex: string): [number, number, number] | null {
  const s = hex.trim().replace("#", "");
  if (s.length !== 6) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

export interface HighlightHandle {
  teardown: () => void;
  /** Re-paint tints right now without waiting for the next editor update.
   * Used by the colour picker after an optimistic character-list mutation
   * — the editor itself didn't change, so registerUpdateListener wouldn't
   * fire and the new colour would only show up on the next keystroke. */
  refresh: () => void;
}

export function installHighlight(
  editor: LexicalEditor,
  getCharacters: () => ScriptCharacter[],
): HighlightHandle {
  let lastApplied = new WeakMap<HTMLElement, string>();

  const apply = () => {
    const chars = getCharacters();
    // Build the lookup map even when empty so we can clear stale tints
    // (case: a character was renamed/deleted — its dialog blocks should
    // lose the colour rather than keep the previous value).
    const colorByName = new Map<string, string>();
    for (const c of chars) {
      colorByName.set(c.name.toUpperCase(), c.color);
    }

    // Read the current paper colour at apply time. Theme / dark-paper
    // changes call refresh(), so once per run is enough.
    const paper = currentPaper();

    editor.getEditorState().read(() => {
      const root = $getRoot();
      let currentName: string | null = null;
      for (const child of root.getChildren()) {
        const type = child.getType();
        if ($isScriptzCharacterNode(child)) {
          const name = child.getTextContent().trim().toUpperCase();
          currentName = name || null;
        } else if (type !== "scriptz-dialog" && !isParenCueText(child.getTextContent())) {
          // An Action block resets the speaker context - a dialog after
          // stage directions without a new character line shouldn't
          // inherit the previous speaker's tint. Exception: a delivery cue
          // in parentheses ("(whispers)", formerly a parenthetical block)
          // sits inside the speech run and keeps the speaker.
          currentName = null;
        }
        if (!TINT_BLOCKS.has(type)) continue;
        const dom = editor.getElementByKey(child.getKey()) as HTMLElement | null;
        if (!dom) continue;

        let speaker: string | null = null;
        if ($isScriptzCharacterNode(child)) {
          const own = child.getTextContent().trim().toUpperCase();
          speaker = own || null;
        } else {
          speaker = currentName;
        }
        const color = speaker ? colorByName.get(speaker) ?? null : null;
        const next = color ? hexToTint(color, 0.28, paper) : "";
        const prev = lastApplied.get(dom) ?? "";
        if (next === prev) continue;
        if (next) {
          dom.style.setProperty("--char-tint", next);
        } else {
          dom.style.removeProperty("--char-tint");
        }
        lastApplied.set(dom, next);
      }
    });
  };

  // Initial pass after mount — give Lexical a frame to render the DOM.
  const raf = requestAnimationFrame(apply);
  const teardownUpdate = editor.registerUpdateListener(() => {
    apply();
  });

  return {
    teardown: () => {
      cancelAnimationFrame(raf);
      teardownUpdate();
      // Drop refs so GC can reclaim DOM nodes once detached.
      lastApplied = new WeakMap();
    },
    refresh: apply,
  };
}
