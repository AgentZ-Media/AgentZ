import { JSX, Show, createEffect, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";

// Shared modal frame for the Werkbank dialogs (quick capture, export,
// settings, activity, onboarding): scrim + `.dlg` surface from the design
// package, Escape to close, Tab focus trap, initial focus and focus
// restore. Lives next to the settings dialog because package E owns it;
// candidates for components/Common once the redesign has settled.

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogFrameProps {
  open: boolean;
  onClose(): void;
  /** Accessible dialog name. */
  label: string;
  /** Extra classes on the dialog surface (next to `dlg`). */
  class?: string;
  /** "center" (default) or "top" (upper third, capture style). */
  placement?: "center" | "top";
  /** Replaces the default `scrim` overlay class (e.g. full-window onboarding). */
  layerClass?: string;
  /** Replaces the `dlg` surface class entirely. */
  surfaceClass?: string;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Called on close to decide whether focus returns to the element that
   *  was focused before the dialog opened (e.g. the editor). Default true. */
  restoreFocus?: () => boolean;
  children: JSX.Element;
}

export function DialogFrame(props: DialogFrameProps) {
  let surface: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  const focusables = () =>
    surface ? Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement) : [];

  const onKey = (e: KeyboardEvent) => {
    if (!props.open || !surface || e.defaultPrevented) return;
    if (e.key === "Escape") {
      // Nested popovers (menus, colour picker, confirm) handle their own
      // Escape; some listen after us, so check for them explicitly.
      if (document.querySelector(".fm-menu, .scriptz-color-popover, .modal-backdrop")) return;
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const list = focusables();
    if (list.length === 0) {
      e.preventDefault();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (!active || !surface.contains(active)) {
      // Focus escaped (e.g. clicked the scrim) - pull it back in.
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  let wasOpen = false;
  createEffect(() => {
    const open = props.open;
    if (open && !wasOpen) {
      previousFocus = document.activeElement as HTMLElement | null;
      document.addEventListener("keydown", onKey);
      requestAnimationFrame(() => {
        if (!surface) return;
        const target =
          surface.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0] ?? surface;
        target.focus({ preventScroll: true });
      });
    } else if (!open && wasOpen) {
      document.removeEventListener("keydown", onKey);
      const prev = previousFocus;
      previousFocus = null;
      const restore = props.restoreFocus ? props.restoreFocus() : true;
      if (restore && prev && prev.isConnected) {
        try {
          prev.focus({ preventScroll: true });
        } catch {
          /* element gone */
        }
      }
    }
    wasOpen = open;
  });
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={props.layerClass ?? "scrim"}
          classList={{ top: !props.layerClass && props.placement === "top" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && (props.closeOnBackdrop ?? true)) props.onClose();
          }}
        >
          <div
            ref={surface}
            class={`${props.surfaceClass ?? "dlg"}${props.class ? ` ${props.class}` : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={props.label}
            tabindex="-1"
          >
            {props.children}
          </div>
        </div>
      </Portal>
    </Show>
  );
}
