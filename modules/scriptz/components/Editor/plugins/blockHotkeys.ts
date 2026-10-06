import {
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  BaseScriptzNode,
  $createScriptzActionNode,
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
  $createScriptzParentheticalNode,
} from "../nodes";
import type { BlockType } from "../../../lib/types";

const FACTORY: Record<BlockType, () => BaseScriptzNode> = {
  "scriptz-action": $createScriptzActionNode,
  "scriptz-character": $createScriptzCharacterNode,
  "scriptz-dialog": $createScriptzDialogNode,
  "scriptz-parenthetical": $createScriptzParentheticalNode,
};

// ⌘1 Action, ⌘2 Character, ⌘3 Dialog, ⌘4 Parenthetical. ⌘5..⌘7 are
// deliberately NOT handled: the editor
// ignores them and the event keeps its default (e.g. browser tab switching
// on the web).
const DIGIT_TO_BLOCK: Record<string, BlockType> = {
  "1": "scriptz-action",
  "2": "scriptz-character",
  "3": "scriptz-dialog",
  "4": "scriptz-parenthetical",
};

function findScriptzAncestor(node: LexicalNode | null): BaseScriptzNode | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if (cur instanceof BaseScriptzNode) return cur;
    cur = cur.getParent();
  }
  return null;
}

/**
 * Switches the block at the cursor to the given type (⌘1..⌘4 hotkeys),
 * incl. caret placement at the end of the block.
 *
 * Returns true when a block was actually switched, otherwise false
 * (no cursor in a scriptz block, or the block is already of this type).
 */
export function setBlockType(editor: LexicalEditor, target: BlockType): boolean {
  let didChange = false;
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const block = findScriptzAncestor(selection.anchor.getNode());
    if (!block) return;
    if (block.getBlockType() === target) return;

    const fresh = FACTORY[target]();
    const text = block.getTextContent();
    // CLAUDE.md invariant: empty blocks must stay CHILDLESS — Lexical's
    // reconciler injects a managed <br> placeholder and WebKit can place
    // the caret. Pre-seeding $createTextNode("") breaks caret placement.
    if (text.length > 0) {
      fresh.append($createTextNode(text));
    }
    block.replace(fresh);
    if (fresh.getChildrenSize() > 0) {
      fresh.selectEnd();
    } else {
      fresh.select(0, 0);
    }
    didChange = true;
  });
  return didChange;
}

export function installBlockHotkeys(editor: LexicalEditor): () => void {
  return editor.registerCommand<KeyboardEvent>(
    KEY_DOWN_COMMAND,
    (event) => {
      if (!(event.metaKey || event.ctrlKey)) return false;
      if (event.shiftKey || event.altKey) return false;
      const target = DIGIT_TO_BLOCK[event.key];
      if (!target) return false;

      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;
      const block = findScriptzAncestor(selection.anchor.getNode());
      if (!block) return false;

      // Already this type? swallow the event (no-op) so it doesn't bubble
      // and trigger e.g. browser Find.
      if (block.getBlockType() === target) {
        event.preventDefault();
        return true;
      }

      // Defer to the shared setter (single source of truth).
      event.preventDefault();
      setBlockType(editor, target);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}
