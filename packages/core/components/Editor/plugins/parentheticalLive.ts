import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  BaseScriptzNode,
  $createScriptzDialogNode,
  $createScriptzParentheticalNode,
  $isScriptzDialogNode,
  $isScriptzParentheticalNode,
} from "../nodes";

function findScriptzAncestor(node: LexicalNode | null): BaseScriptzNode | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if (cur instanceof BaseScriptzNode) return cur;
    cur = cur.getParent();
  }
  return null;
}

/**
 * State machine, intercepted at keydown so the browser/Lexical default text
 * insertion never runs (CONTROLLED_TEXT_INSERTION_COMMAND was only firing
 * reliably on empty Dialog blocks):
 *   - In a Dialog block, typing `(` splits the dialog at the cursor and
 *     drops in a Parenthetical containing `(`. Any text right of the cursor
 *     moves into a fresh Dialog after the parenthetical. Caret lands in the
 *     parenthetical.
 *   - In a Parenthetical block, typing `)` appends the closing paren and
 *     jumps to the next Dialog (creating one if missing).
 */
export function installParentheticalLive(editor: LexicalEditor): () => void {
  return editor.registerCommand<KeyboardEvent>(
    KEY_DOWN_COMMAND,
    (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key !== "(" && event.key !== ")") return false;

      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return false;
      const block = findScriptzAncestor(sel.anchor.getNode());
      if (!block) return false;

      if (event.key === "(" && $isScriptzDialogNode(block)) {
        event.preventDefault();
        const paren = $createScriptzParentheticalNode();
        paren.append($createTextNode("("));

        // Empty Dialog → replace it in place. Otherwise the writer ends up
        // with a stranded blank dialog line above the parenthetical.
        if (block.getTextContent().length === 0) {
          block.replace(paren);
          paren.selectEnd();
          return true;
        }

        const trailing = collectTrailingNodes(
          sel.anchor.getNode(),
          sel.anchor.offset,
          block,
        );
        block.insertAfter(paren);

        if (trailing.length > 0) {
          const trailingDialog = $createScriptzDialogNode();
          for (const node of trailing) {
            node.remove();
            trailingDialog.append(node);
          }
          paren.insertAfter(trailingDialog);
        }

        // Cursor was at the start of the dialog line: all content has moved
        // into trailingDialog; the original block is now empty and
        // would otherwise remain as a visible blank line between the character and
        // the parenthetical.
        if (block.getChildrenSize() === 0) {
          block.remove();
        }

        paren.selectEnd();
        return true;
      }

      if (event.key === ")" && $isScriptzParentheticalNode(block)) {
        event.preventDefault();
        const last = block.getLastChild();
        if ($isTextNode(last)) {
          last.setTextContent(last.getTextContent() + ")");
        } else {
          block.append($createTextNode(")"));
        }

        const next = block.getNextSibling();
        if (next && $isScriptzDialogNode(next)) {
          next.selectStart();
        } else {
          const dialog = $createScriptzDialogNode();
          block.insertAfter(dialog);
          dialog.select(0, 0);
        }
        return true;
      }

      return false;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/**
 * Returns the inline nodes inside `block` that lie at or after `(anchorNode, offset)`.
 * If the anchor is a text node and the offset falls mid-text, the text node is
 * split first so the trailing portion preserves its formatting. The returned
 * nodes are still attached; the caller should detach and re-parent them.
 */
function collectTrailingNodes(
  anchorNode: LexicalNode,
  offset: number,
  block: BaseScriptzNode,
): LexicalNode[] {
  const trailing: LexicalNode[] = [];

  if ($isTextNode(anchorNode) && anchorNode.getParent() === block) {
    const size = anchorNode.getTextContentSize();
    let firstTrailing: LexicalNode | null;

    if (offset === 0) {
      firstTrailing = anchorNode;
    } else if (offset >= size) {
      firstTrailing = anchorNode.getNextSibling();
    } else {
      const parts = anchorNode.splitText(offset);
      firstTrailing = parts[1] ?? null;
    }

    let cur: LexicalNode | null = firstTrailing;
    while (cur) {
      trailing.push(cur);
      cur = cur.getNextSibling();
    }
    return trailing;
  }

  // Anchor is the block element itself (e.g. empty block, or caret between
  // children). offset indexes into block.getChildren().
  if (anchorNode === block) {
    const children = block.getChildren();
    for (let i = offset; i < children.length; i++) {
      trailing.push(children[i]!);
    }
  }

  return trailing;
}
