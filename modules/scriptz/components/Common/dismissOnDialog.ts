import { createEffect, on, onCleanup } from "solid-js";
import { uiStore } from "../../stores/ui";

export interface DialogDismissOptions {
  /** Whether the menu / popover is open right now. */
  open: () => boolean;
  /** True when `node` belongs to the menu: trigger, surface, submenus. */
  inside: (node: Node) => boolean;
  /** Closes the menu WITHOUT moving focus - a dialog owns it now. */
  dismiss: () => void;
  /** Also close when focus moves outside the menu (default true). Off for
   *  popovers that legitimately leave focus elsewhere (e.g. the editor). */
  trackFocus?: boolean;
}

/**
 * Transient menus and popovers must never outlive a dialog that opens on
 * top of them: a menu that keeps listening to the keyboard would swallow
 * keys typed into the dialog (digits, Enter, arrows), act on the page
 * behind it and pull focus back out of the dialog.
 *
 * Closes the menu (without restoring focus) when
 *   - any shell dialog opens (`uiStore.anyDialogOpen()` turns true), or
 *   - focus moves to an element outside the menu (covers the legacy modals
 *     like ConfirmDialog / PromptDialog, which grab focus on open).
 *
 * Must be called inside a component / reactive owner.
 */
export function dismissOnDialog(opts: DialogDismissOptions): void {
  createEffect(
    on(
      uiStore.anyDialogOpen,
      (now, prev) => {
        if (now && !prev && opts.open()) opts.dismiss();
      },
      { defer: true },
    ),
  );
  if (opts.trackFocus === false) return;
  createEffect(() => {
    if (!opts.open()) return;
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (target instanceof Node && opts.inside(target)) return;
      opts.dismiss();
    };
    document.addEventListener("focusin", onFocusIn, true);
    onCleanup(() => document.removeEventListener("focusin", onFocusIn, true));
  });
}

/** True when keyboard focus is inside `el` (the gate for document-level
 *  key handlers of open menus). */
export function focusWithin(el: Element | null | undefined): boolean {
  const active = document.activeElement;
  return !!el && !!active && el.contains(active);
}
