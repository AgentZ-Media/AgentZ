import {
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import {
  BaseScriptzNode,
  $createScriptzActionNode,
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
  $isScriptzActionNode,
  $isScriptzCharacterNode,
  $isScriptzDialogNode,
  $isScriptzParentheticalNode,
} from "../nodes";
import type { ScriptCharacter } from "../../../lib/types";

function findScriptzAncestor(node: LexicalNode | null): BaseScriptzNode | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if (cur instanceof BaseScriptzNode) return cur;
    cur = cur.getParent();
  }
  return null;
}

// Smart-Enter state machine (four block types):
//   Action        (text)  -> new Character below
//   Action        (empty) -> becomes Character
//   Character     (text)  -> new Dialog below
//   Character     (empty) -> becomes Action
//   Dialog        (text)  -> new Character below; in quick mode with
//                            exactly two characters: pre-filled OTHER
//                            speaker + Dialog
//   Dialog        (empty) -> becomes Character (quick mode: the other
//                            speaker)
//   Parenthetical (text)  -> new Dialog below
//   Parenthetical (empty) -> becomes Dialog
// So from an Action line, Enter leads to a Character and a second Enter
// (on the still empty Character) back to Action - both are one key away.
// Shift+Enter is left to Lexical (line break inside the block).

function insertNewBlockAfter(
  block: BaseScriptzNode,
  next: BaseScriptzNode,
): void {
  block.insertAfter(next);
  next.select(0, 0);
}

function replaceBlockWith(
  block: BaseScriptzNode,
  next: BaseScriptzNode,
): void {
  block.replace(next);
  next.select(0, 0);
}

/** Walk back from a Dialog block to find the most recent Character block
 * above it. Returns its uppercase trimmed name, or null if none found. */
function previousCharacterName(block: BaseScriptzNode): string | null {
  let prev: LexicalNode | null = block.getPreviousSibling();
  while (prev) {
    if ($isScriptzCharacterNode(prev)) {
      const name = prev.getTextContent().trim().toUpperCase();
      return name || null;
    }
    prev = prev.getPreviousSibling();
  }
  return null;
}

export interface SmartEnterArgs {
  /** Reactive getter for the quick-mode toggle. */
  isQuickModeOn?: () => boolean;
  /** Reactive getter for the live character list (excludes the
   * currently-edited block — see Editor.tsx persist). */
  getCharacters?: () => ScriptCharacter[];
}

export function installSmartEnter(
  editor: LexicalEditor,
  args: SmartEnterArgs = {},
): () => void {
  return mergeRegister(
    editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        if (event && event.shiftKey) return false;

        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        if (!selection.isCollapsed()) return false;

        const anchor = selection.anchor.getNode();
        const block = findScriptzAncestor(anchor);
        if (!block) return false;

        const text = block.getTextContent();
        const isEmpty = text.trim().length === 0;

        if ($isScriptzCharacterNode(block) && isEmpty) {
          replaceBlockWith(block, $createScriptzActionNode());
          if (event) event.preventDefault();
          return true;
        }
        if ($isScriptzActionNode(block) && isEmpty) {
          replaceBlockWith(block, $createScriptzCharacterNode());
          if (event) event.preventDefault();
          return true;
        }

        if ($isScriptzCharacterNode(block)) {
          insertNewBlockAfter(block, $createScriptzDialogNode());
          if (event) event.preventDefault();
          return true;
        }

        if ($isScriptzActionNode(block)) {
          insertNewBlockAfter(block, $createScriptzCharacterNode());
          if (event) event.preventDefault();
          return true;
        }
        if ($isScriptzDialogNode(block)) {
          // Quick mode: when the script has exactly two characters, skip
          // the empty Character step and pre-fill the OTHER one, dropping
          // the writer straight into a fresh Dialog. Saves a tab/Enter
          // per turn for two-hander dialogue.
          if (args.isQuickModeOn?.()) {
            const chars = args.getCharacters?.() ?? [];
            if (chars.length === 2) {
              const prev = previousCharacterName(block);
              const other = chars.find(
                (c) => c.name.toUpperCase() !== (prev ?? "").toUpperCase(),
              );
              if (other) {
                const charBlock = $createScriptzCharacterNode();
                charBlock.setCharacterName(other.name.toUpperCase());
                charBlock.append($createTextNode(other.name.toUpperCase()));
                const nextDialog = $createScriptzDialogNode();
                // Empty dialog (typical after closing a parenthetical)
                // → replace it so we don't strand a blank line above the
                // new character.
                if (isEmpty) {
                  (block as BaseScriptzNode).replace(charBlock);
                } else {
                  (block as BaseScriptzNode).insertAfter(charBlock);
                }
                charBlock.insertAfter(nextDialog);
                nextDialog.select(0, 0);
                if (event) event.preventDefault();
                return true;
              }
            }
          }
          // Empty dialog → replace in place so we don't leave a blank
          // dialog line above the new Character (common case after
          // closing a parenthetical with `)`).
          if (isEmpty) {
            replaceBlockWith(block, $createScriptzCharacterNode());
          } else {
            insertNewBlockAfter(block, $createScriptzCharacterNode());
          }
          if (event) event.preventDefault();
          return true;
        }
        if ($isScriptzParentheticalNode(block)) {
          // Empty parenthetical → replace with Dialog (e.g. the writer
          // typed "(" by mistake, deleted it and hit Enter).
          if (isEmpty) {
            replaceBlockWith(block, $createScriptzDialogNode());
          } else {
            insertNewBlockAfter(block, $createScriptzDialogNode());
          }
          if (event) event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    ),

    // Backspace at offset 0 of an EMPTY block: remove it and jump to the end
    // of the previous block. The very first block can't be removed - it is
    // turned into Action instead (the neutral type). Non-empty blocks and
    // other offsets fall through to Lexical's default handling.
    editor.registerCommand<KeyboardEvent>(
      KEY_BACKSPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return false;
        if (!selection.isCollapsed()) return false;

        const anchor = selection.anchor;
        if (anchor.offset !== 0) return false;

        const block = findScriptzAncestor(anchor.getNode());
        if (!block) return false;

        const text = block.getTextContent();
        if (text.length > 0) return false;

        const prev = block.getPreviousSibling();
        if (!prev || !$isElementNode(prev)) {
          if (!$isScriptzActionNode(block)) {
            replaceBlockWith(block, $createScriptzActionNode());
            event.preventDefault();
            return true;
          }
          return false;
        }

        block.remove();
        if ($isElementNode(prev)) {
          prev.selectEnd();
        }
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
