/**
 * Per-script view state that survives navigating away and back.
 *
 * When you navigate from script A to B and back (sidebar, history, palette), you should land
 * where you were: scroll position of the paper canvas + cursor in
 * the editor. ScriptScreen pauses briefly on switch, saves the
 * state for A into this map and reads the matching entry back out
 * on the mount step for B (or when switching back to A later).
 *
 * The map only lives in memory for the running app session. It is
 * *not* persisted across app restarts - that would
 * mean the cursor lands days later at a spot the user has
 * long forgotten. The session is enough.
 *
 * The cursor is addressed structurally (block index in root.children +
 * offset), not via Lexical keys: those are reassigned on every
 * `parseEditorState`, so a stored key points into the void after
 * the editor remount.
 */

import {
  $createRangeSelection,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  $setSelection,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

export type CursorAddress = {
  /** Index of the top-level block in root.getChildren(). */
  blockIndex: number;
  /** Path from the block down to the anchor node; each number is a
   *  child index at the respective level. Empty means: the anchor
   *  is at the block itself (type "element"). Important for blocks with
   *  multiple text descendants (e.g. after inline bold), where the
   *  block-relative offset alone would point at the WRONG text node. */
  path: number[];
  /** Offset within the target node (text offset for type "text",
   *  child index for type "element"). */
  offset: number;
  /** Selection type as in Lexical. */
  type: "text" | "element";
};

export type ScriptViewState = {
  scrollTop: number;
  cursor: CursorAddress | null;
};

const cache = new Map<string, ScriptViewState>();

export const scriptViewCache = {
  get(id: string): ScriptViewState | undefined {
    return cache.get(id);
  },
  set(id: string, state: ScriptViewState) {
    cache.set(id, state);
  },
};

/** Reads the current cursor position from the editor and returns it as
 *  a structural address. Range selections only - node selections
 *  (e.g. a selected image) are not possible in this editor. */
export function captureCursor(editor: LexicalEditor): CursorAddress | null {
  let result: CursorAddress | null = null;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const path: number[] = [];
    let node: LexicalNode | null = sel.anchor.getNode();
    let blockIndex = -1;
    while (node) {
      const parent: LexicalNode | null = node.getParent();
      if (!parent) break;
      if ($isRootNode(parent)) {
        blockIndex = node.getIndexWithinParent();
        break;
      }
      path.unshift(node.getIndexWithinParent());
      node = parent;
    }
    if (blockIndex < 0) return;
    result = {
      blockIndex,
      path,
      offset: sel.anchor.offset,
      type: sel.anchor.type,
    };
  });
  return result;
}

/** Sets the selection in the editor at the given address. Tolerates
 *  drift: if the block count has shrunk since capture, it
 *  clamps to the last block; if the path no longer resolves
 *  (e.g. because inline format was removed), it falls back to the first
 *  text descendant and clamps the offset; if that's also
 *  fruitless, the selection lands element-relative at the block. */
export function applyCursor(editor: LexicalEditor, addr: CursorAddress): void {
  editor.update(() => {
    const root = $getRoot();
    const blocks = root.getChildren();
    if (blocks.length === 0) return;
    const idx = Math.max(0, Math.min(addr.blockIndex, blocks.length - 1));
    const block = blocks[idx];

    if (addr.type === "text") {
      const target = resolvePath(block, addr.path) ?? findFirstTextDescendant(block);
      if (target && isTextLike(target)) {
        const len = target.getTextContentSize();
        const off = Math.max(0, Math.min(addr.offset, len));
        const sel = $createRangeSelection();
        sel.anchor.set(target.getKey(), off, "text");
        sel.focus.set(target.getKey(), off, "text");
        $setSelection(sel);
        return;
      }
    }

    const sel = $createRangeSelection();
    sel.anchor.set(block.getKey(), 0, "element");
    sel.focus.set(block.getKey(), 0, "element");
    $setSelection(sel);
  });
}

type ElementLike = { getChildren?: () => LexicalNode[] };
type TextLike = { getKey(): string; getTextContentSize(): number };

function resolvePath(start: LexicalNode, path: number[]): LexicalNode | null {
  let node: LexicalNode = start;
  for (const i of path) {
    const children = (node as unknown as ElementLike).getChildren?.();
    if (!children || i < 0 || i >= children.length) return null;
    node = children[i];
  }
  return node;
}

function isTextLike(node: LexicalNode): node is LexicalNode & TextLike {
  return node.getType() === "text";
}

function findFirstTextDescendant(node: LexicalNode): (LexicalNode & TextLike) | null {
  if (node.getType() === "text") return node as LexicalNode & TextLike;
  const children = (node as unknown as ElementLike).getChildren?.();
  if (!children) return null;
  for (const c of children) {
    const found = findFirstTextDescendant(c);
    if (found) return found;
  }
  return null;
}
