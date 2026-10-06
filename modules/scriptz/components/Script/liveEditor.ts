// Live view of the mounted Lexical editor for the script screen: the block
// list for timeline + inspector (debounced), the caret block (immediate,
// drives the gutter label and the playhead) and whether the editor has
// keyboard focus.
//
// Reads only - never mutates editor state.

import { batch, createSignal, onCleanup, type Accessor } from "solid-js";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import type { TimingBlock } from "../../lib/timing";
import type { BlockType } from "../../lib/types";

const BLOCKS_DEBOUNCE_MS = 150;

export interface CaretBlock {
  key: string;
  type: BlockType;
}

export interface LiveEditorModel {
  blocks: Accessor<TimingBlock[]>;
  caret: Accessor<CaretBlock | null>;
  focused: Accessor<boolean>;
  /** Bumps on every editor update that changed content (layout may have
   *  changed). Selection-only updates (arrow keys, clicks) don't: overlays
   *  measuring the paper would otherwise force a layout per caret move. */
  tick: Accessor<number>;
  /** Bumps on every editor update, selection-only ones included. */
  cursorTick: Accessor<number>;
  /** True once `blocks` reflect the attached editor's loaded content
   *  (false right after attaching, before the first debounced read). */
  loaded: Accessor<boolean>;
  /** Attach to an editor instance; returns a detach function. */
  attach(editor: LexicalEditor): () => void;
}

function kindOf(type: string): TimingBlock["kind"] {
  if (type === "scriptz-character") return "character";
  if (type === "scriptz-dialog") return "dialog";
  if (type === "scriptz-parenthetical") return "paren";
  return "action";
}

function asBlockType(type: string): BlockType {
  if (
    type === "scriptz-character" ||
    type === "scriptz-dialog" ||
    type === "scriptz-parenthetical"
  ) {
    return type;
  }
  return "scriptz-action";
}

function readBlocks(editor: LexicalEditor): TimingBlock[] {
  const out: TimingBlock[] = [];
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) {
      out.push({ key: child.getKey(), kind: kindOf(child.getType()), text: child.getTextContent() });
    }
  });
  return out;
}

function readCaret(editor: LexicalEditor): CaretBlock | null {
  let caret: CaretBlock | null = null;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel)) return;
    const node = sel.anchor.getNode();
    const top = node.getParent() === null ? null : node.getTopLevelElement();
    if (!top) return;
    caret = { key: top.getKey(), type: asBlockType(top.getType()) };
  });
  return caret;
}

function sameBlocks(a: TimingBlock[], b: TimingBlock[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].key !== b[i].key || a[i].kind !== b[i].kind || a[i].text !== b[i].text) return false;
  }
  return true;
}

function sameCaret(a: CaretBlock | null, b: CaretBlock | null): boolean {
  return a === b || (!!a && !!b && a.key === b.key && a.type === b.type);
}

/** Must be called inside a Solid owner (component body). */
export function createLiveEditorModel(): LiveEditorModel {
  const [blocks, setBlocks] = createSignal<TimingBlock[]>([]);
  const [caret, setCaret] = createSignal<CaretBlock | null>(null);
  const [focused, setFocused] = createSignal(false);
  const [tick, setTick] = createSignal(0);
  const [cursorTick, setCursorTick] = createSignal(0);
  const [loaded, setLoaded] = createSignal(false);
  let detachCurrent: (() => void) | null = null;

  const attach = (editor: LexicalEditor) => {
    detachCurrent?.();
    let timer: ReturnType<typeof setTimeout> | null = null;

    // The editor hands itself over before its content is parsed - start
    // empty and wait for the first update.
    setLoaded(false);
    setBlocks([]);
    setCaret(null);

    // Recompute on every update (debounced) rather than only on dirty
    // nodes: the initial `setEditorState` after mount is a full reconcile
    // that doesn't always report dirty nodes. Unchanged results are dropped
    // so selection-only updates don't re-render the timeline.
    let first = true;
    const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      const nextCaret = readCaret(editor);
      batch(() => {
        if (!sameCaret(caret(), nextCaret)) setCaret(nextCaret);
        // The first update after attaching may be a full reconcile without
        // dirty nodes (see above): it always counts as a content change.
        if (first || dirtyElements.size > 0 || dirtyLeaves.size > 0) setTick((n) => n + 1);
        setCursorTick((n) => n + 1);
      });
      first = false;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const next = readBlocks(editor);
        batch(() => {
          if (!sameBlocks(blocks(), next)) setBlocks(next);
          setLoaded(true);
        });
      }, BLOCKS_DEBOUNCE_MS);
    });

    const root = editor.getRootElement();
    const onFocusIn = () => setFocused(true);
    const onFocusOut = () => setFocused(false);
    root?.addEventListener("focusin", onFocusIn);
    root?.addEventListener("focusout", onFocusOut);
    setFocused(!!root && root.contains(document.activeElement));

    const detach = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      unregister();
      root?.removeEventListener("focusin", onFocusIn);
      root?.removeEventListener("focusout", onFocusOut);
      if (detachCurrent === detach) detachCurrent = null;
    };
    detachCurrent = detach;
    return detach;
  };

  onCleanup(() => detachCurrent?.());

  return { blocks, caret, focused, tick, cursorTick, loaded, attach };
}
