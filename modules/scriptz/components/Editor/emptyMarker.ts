import { $getRoot, type LexicalEditor } from "lexical";

/** Toggles `data-empty="1"` on the editor root when the doc has exactly
 *  one block with empty text. CSS uses this attribute to render the
 *  `⌘ hint` element next to the editor. Reads the editor state
 *  synchronously and runs after every keystroke, so it must stay cheap. */
export function updateEmptyMarker(editor: LexicalEditor, rootEl: HTMLElement | undefined): void {
  if (!rootEl) return;
  let isEmpty = true;
  editor.getEditorState().read(() => {
    const root = $getRoot();
    // Size first: never materialize the block list of a long script.
    isEmpty = root.getChildrenSize() === 1 && (root.getFirstChild()?.getTextContent().trim().length ?? 0) === 0;
  });
  if (isEmpty) rootEl.setAttribute("data-empty", "1");
  else rootEl.removeAttribute("data-empty");
}
