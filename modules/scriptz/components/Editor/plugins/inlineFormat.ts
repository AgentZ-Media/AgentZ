import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { mergeRegister } from "@lexical/utils";
import {
  findScriptzAncestor,
  $isScriptzActionNode,
  $isScriptzDialogNode,
} from "../nodes";

/** Inline formatting: ⌘B (bold) and ⌘U (underline) in Action and Dialog
 *  blocks (Character and Parenthetical stay unformatted - the
 *  parenthetical is already set in italics by CSS). Italic is not
 *  available in ScriptZ at all:
 *
 *  - ⌘I / Ctrl+I belongs to the global idea quick-capture. The shell's
 *    listener sits on `window` in the bubble phase, i.e. it runs AFTER
 *    Lexical's keydown handling on the editor root. Lexical's own default
 *    (`$handleKeyDown`, editor priority) would therefore apply italic
 *    before the capture dialog opens. We claim the key here first with
 *    `return true` (stops Lexical) but deliberately WITHOUT
 *    preventDefault(): the shell shortcut handler skips events that are
 *    already default-prevented, so preventing here would swallow the
 *    capture. The shell calls preventDefault itself, which also stops the
 *    browser's native italic; without a shell a native
 *    `formatItalic` beforeinput ends in the FORMAT_TEXT_COMMAND guard.
 *  - A FORMAT_TEXT_COMMAND guard swallows "italic" from any other source
 *    (context menus, programmatic dispatches, future toolbars). */
export function installInlineFormat(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerCommand<KeyboardEvent>(
      KEY_DOWN_COMMAND,
      (event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (!mod) return false;
        const k = event.key.toLowerCase();

        if (k === "i" && !event.altKey) return true;

        if (event.defaultPrevented) return false;
        if (k !== "b" && k !== "u") return false;

        let allow = false;
        editor.getEditorState().read(() => {
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const block = findScriptzAncestor(sel.anchor.getNode());
          if (!block) return;
          if ($isScriptzActionNode(block) || $isScriptzDialogNode(block)) {
            allow = true;
          }
        });

        if (!allow) {
          // Block formatting in non-eligible blocks.
          event.preventDefault();
          return true;
        }

        const fmt: TextFormatType = k === "b" ? "bold" : "underline";
        event.preventDefault();
        editor.dispatchCommand(FORMAT_TEXT_COMMAND, fmt);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<TextFormatType>(
      FORMAT_TEXT_COMMAND,
      (format) => format === "italic",
      COMMAND_PRIORITY_CRITICAL,
    ),
  );
}
