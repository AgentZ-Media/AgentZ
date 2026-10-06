import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import { $isScriptzCharacterNode, findScriptzAncestor } from "./nodes";
import { DEFAULT_PALETTE } from "../../lib/characterColors";
import type { ScriptCharacter } from "../../lib/types";

/** Neutral placeholder color for character pills the user JUST typed —
 *  the next debounced save canonicalizes it via the save result. The
 *  live reconcile path does not rely on this color (it would cause grey
 *  dots while typing fast), but other reads need the sentinel to detect
 *  "not yet resolved". */
export const PENDING_CHAR_COLOR = "#9aa0a6";

export interface CharacterReconcileOptions {
  editor: LexicalEditor;
  /** Read-only access to the app-wide character color cache (name → color)
   *  loaded once on mount from `api.listCharacterColors()`. Held as a Map
   *  by the owner so the persist path can update it without re-wiring. */
  getKnownColors: () => Map<string, string>;
  getLiveCharacters: () => ScriptCharacter[];
  setLiveCharacters: (next: ScriptCharacter[]) => void;
  /** Called whenever liveCharacters actually changes — drives both the
   *  parent's quick-mode availability and the highlight plugin's repaint. */
  onChange: (next: ScriptCharacter[]) => void;
}

export interface CharacterReconcileHandle {
  /** Returns true if liveCharacters was changed by this call. Runs
   *  synchronously inside `editor.getEditorState().read()` — safe to call
   *  on every update listener tick. */
  reconcileLiveCharactersSync: () => boolean;
  /** Re-walks the editor state and merges in persisted colors from the
   *  save summary. Names typed mid-flight (not yet persisted) keep their
   *  locally-chosen palette color instead of reverting to
   *  `PENDING_CHAR_COLOR`. Returns whether anything changed. */
  mergeAfterSave: (
    summary: { characters: ScriptCharacter[] },
  ) => boolean;
  /** Merges color-only updates from an INCOMING parent prop into the
   *  live list, leaving currently-typed names alone. Returns whether
   *  anything changed. Used by the createEffect that watches
   *  `props.characters`. */
  mergeExternalColors: (incoming: ScriptCharacter[]) => boolean;
}

/** Walks the root and collects unique uppercased character names —
 *  EXCLUDING the block the cursor is currently inside (otherwise an
 *  in-progress rename would briefly drop the character from the pill list
 *  on each keystroke). Pure helper, callable inside an editor read. */
function collectCharacterNames(editor: LexicalEditor): string[] {
  const seenNames: string[] = [];
  const seenSet = new Set<string>();
  editor.getEditorState().read(() => {
    let editedCharKey: string | null = null;
    const sel = $getSelection();
    if ($isRangeSelection(sel)) {
      const node = findScriptzAncestor(sel.anchor.getNode());
      if ($isScriptzCharacterNode(node)) editedCharKey = node.getKey();
    }
    const root = $getRoot();
    for (const child of root.getChildren()) {
      if (
        $isScriptzCharacterNode(child) &&
        child.getKey() !== editedCharKey
      ) {
        const name = child.getTextContent().trim().toUpperCase();
        if (name && !seenSet.has(name)) {
          seenSet.add(name);
          seenNames.push(name);
        }
      }
    }
  });
  return seenNames;
}

/** Mirrors `pickPaletteInScript` from characterColors.ts so the later
 *  storage write (which uses the same heuristic) lands on the same color
 *  and no visible re-coloring happens. */
function pickFallbackColor(existing: ScriptCharacter[]): string {
  const used = new Set<string>();
  for (const c of existing) used.add(c.color);
  for (const p of DEFAULT_PALETTE) {
    if (!used.has(p)) return p;
  }
  return DEFAULT_PALETTE[0];
}

function listsEqual(a: ScriptCharacter[], b: ScriptCharacter[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].color !== b[i].color) return false;
  }
  return true;
}

export function createCharacterReconcile(
  opts: CharacterReconcileOptions,
): CharacterReconcileHandle {
  const { editor, getKnownColors, getLiveCharacters, setLiveCharacters, onChange } =
    opts;

  const reconcileLiveCharactersSync = (): boolean => {
    const seenNames = collectCharacterNames(editor);
    const prev = getLiveCharacters();
    const colorByPrev = new Map(
      prev.map((c) => [c.name.toUpperCase(), c.color]),
    );
    const knownColors = getKnownColors();
    const next: ScriptCharacter[] = [];
    for (const name of seenNames) {
      const existing = colorByPrev.get(name);
      if (existing && existing !== PENDING_CHAR_COLOR) {
        next.push({ name, color: existing });
        continue;
      }
      const known = knownColors.get(name);
      if (known) {
        next.push({ name, color: known });
        continue;
      }
      next.push({ name, color: pickFallbackColor(next) });
    }
    if (listsEqual(prev, next)) return false;
    setLiveCharacters(next);
    onChange(next);
    return true;
  };

  const mergeAfterSave = (summary: {
    characters: ScriptCharacter[];
  }): boolean => {
    const colorMap = new Map(
      summary.characters.map((c) => [c.name.toUpperCase(), c.color]),
    );
    const currentNames = collectCharacterNames(editor);
    const before = getLiveCharacters();
    const colorByPrev = new Map(
      before.map((c) => [c.name.toUpperCase(), c.color]),
    );
    const merged: ScriptCharacter[] = currentNames.map((name) => ({
      name,
      color:
        colorMap.get(name) ??
        colorByPrev.get(name) ??
        PENDING_CHAR_COLOR,
    }));
    if (listsEqual(before, merged)) return false;
    setLiveCharacters(merged);
    onChange(merged);
    return true;
  };

  const mergeExternalColors = (incoming: ScriptCharacter[]): boolean => {
    const byName = new Map<string, string>();
    for (const c of incoming) byName.set(c.name.toUpperCase(), c.color);
    const current = getLiveCharacters();
    let changed = false;
    const merged = current.map((c) => {
      const next = byName.get(c.name.toUpperCase());
      if (next !== undefined && next !== c.color) {
        changed = true;
        return { ...c, color: next };
      }
      return c;
    });
    if (!changed) return false;
    setLiveCharacters(merged);
    // Note: deliberately does NOT call onChange — this path only
    // recolors EXISTING entries (the parent's character list is the
    // source of truth here, no need to bounce it back), so we just
    // need the highlight repaint, which the caller handles itself.
    return true;
  };

  return { reconcileLiveCharactersSync, mergeAfterSave, mergeExternalColors };
}
