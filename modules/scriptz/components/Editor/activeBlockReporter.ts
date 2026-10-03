import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { BaseScriptzNode } from "./nodes";

export interface ActiveBlockReporterOptions {
  editor: LexicalEditor;
  getRootEl: () => HTMLElement | undefined;
  onActiveBlockChange?: (kind: string | null) => void;
}

export interface ActiveBlockReporterHandle {
  /** Walks the current selection up to the nearest scriptz block and
   *  reports the block kind to the parent — only when it changed since
   *  the last report. Cheap to call from the update listener. */
  reportActiveBlock: () => void;
  /** Toggles `data-empty="1"` on the editor root when the doc has
   *  exactly one block with empty text. CSS uses this attribute to
   *  render the `⌘ hint` element next to the editor. */
  updateEmptyMarker: () => void;
}

/** Selection / empty-state observers extracted from the Editor onMount
 *  closure. The reporter holds the `lastActiveBlock` cache so consecutive
 *  selection changes inside the same block don't spam the parent.
 *
 *  Both functions read the editor state synchronously — they MUST stay
 *  cheap so the update-listener path that runs after every keystroke
 *  doesn't regress typing latency. */
export function createActiveBlockReporter(
  opts: ActiveBlockReporterOptions,
): ActiveBlockReporterHandle {
  const { editor, getRootEl, onActiveBlockChange } = opts;
  let lastActiveBlock: string | null = null;

  const reportActiveBlock = () => {
    if (!onActiveBlockChange) return;
    let kind: string | null = null;
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      let cur: LexicalNode | null = sel.anchor.getNode();
      while (cur) {
        if (cur instanceof BaseScriptzNode) {
          kind = cur.getBlockType();
          break;
        }
        cur = cur.getParent();
      }
    });
    if (kind !== lastActiveBlock) {
      lastActiveBlock = kind;
      onActiveBlockChange(kind);
    }
  };

  const updateEmptyMarker = () => {
    const rootEl = getRootEl();
    if (!rootEl) return;
    let isEmpty = true;
    editor.getEditorState().read(() => {
      const root = $getRoot();
      const children = root.getChildren();
      if (children.length !== 1) {
        isEmpty = false;
        return;
      }
      if (children[0].getTextContent().trim().length > 0) {
        isEmpty = false;
      }
    });
    if (isEmpty) rootEl.setAttribute("data-empty", "1");
    else rootEl.removeAttribute("data-empty");
  };

  return { reportActiveBlock, updateEmptyMarker };
}
