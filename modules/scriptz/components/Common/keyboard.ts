// Keyboard helpers shared by the page-level key handlers.

/** True when `el` takes text input (field, text area, select or a
 *  contenteditable): page shortcuts like "/" or ⌘A leave such keys alone. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}
