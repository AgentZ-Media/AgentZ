import type { LexicalEditor } from "lexical";

/** Word-style: clicking anywhere on the paper-canvas around the
 *  contenteditable (margins, empty space below the last block) drops
 *  the caret at the end of the document. Mirrors how a desktop word
 *  processor treats the page area as "more editor".
 *
 *  Returns a teardown that unbinds the listener; safe to call when no
 *  canvas ancestor was found (no-op). */
export function installCanvasFocus(
  rootRef: HTMLElement,
  editor: LexicalEditor,
): () => void {
  const canvas = rootRef.closest(".paper-canvas") as HTMLElement | null;
  if (!canvas) return () => { /* no canvas, nothing to unbind */ };

  const onMousedown = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    // Click landed inside the editor — let Lexical place the caret
    // at the actual click location.
    if (target.closest(".editor-root")) return;
    // Don't intercept controls (buttons, inputs, dropdowns, recovery panel,
    // etc.) — the user clicked something else on purpose.
    if (
      target.closest("button") ||
      target.closest("input") ||
      target.closest("textarea") ||
      target.closest(".scriptz-block-dropdown") ||
      target.closest(".scriptz-character-dropdown") ||
      target.closest(".recovery-panel")
    ) {
      return;
    }
    ev.preventDefault();
    try {
      editor.focus(undefined, { defaultSelection: "rootEnd" });
    } catch {
      /* ignore */
    }
  };

  canvas.addEventListener("mousedown", onMousedown);
  return () => canvas.removeEventListener("mousedown", onMousedown);
}
