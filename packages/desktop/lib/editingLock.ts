/** Prevent new edits between the flush barrier and native destruction/install.
 * Capture listeners also cover shortcuts and portals outside the app root. */
export function createEditingLock(root: HTMLElement) {
  let locks = 0;
  let previousInert = false;
  const events = ["keydown", "beforeinput", "input", "paste", "cut", "drop", "pointerdown", "click", "compositionstart"];
  const prevent = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  return {
    locked: () => locks > 0,
    acquire(): () => void {
      if (locks++ === 0) {
        previousInert = root.inert;
        // Blur first: editors can commit composition/focus state before flush.
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        root.inert = true;
        root.setAttribute("aria-busy", "true");
        for (const event of events) document.addEventListener(event, prevent, true);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--locks !== 0) return;
        root.inert = previousInert;
        root.removeAttribute("aria-busy");
        for (const event of events) document.removeEventListener(event, prevent, true);
      };
    },
  };
}
