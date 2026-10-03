import { JSX, Show, createEffect, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../../i18n";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: string;
  children: JSX.Element;
  /** Optional element placed in the footer area. */
  footer?: JSX.Element;
  /** Maximum width override (px). */
  maxWidth?: number;
  /** Hide built-in close-on-backdrop. Defaults true. */
  closeOnBackdrop?: boolean;
}

export function Modal(props: ModalProps) {
  let modalRef: HTMLDivElement | undefined;
  let previousFocus: HTMLElement | null = null;

  /** Blur the active element (if it lives in the modal) before closing.
   *  Number / text inputs only commit their `change` event on blur — without
   *  this step, a value change is lost when the user closes via
   *  backdrop click or Escape while an input is focused. */
  const closeWithFlush = () => {
    const active = document.activeElement as HTMLElement | null;
    if (active && modalRef?.contains(active) && typeof active.blur === "function") {
      active.blur();
    }
    props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!props.open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeWithFlush();
      return;
    }
    if (e.key === "Tab" && modalRef) {
      const focusables = Array.from(
        modalRef.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Single focusable: trap on it, no movement.
      if (first === last) {
        e.preventDefault();
        first.focus();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !modalRef.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  onMount(() => {
    document.addEventListener("keydown", onKey, true);
    onCleanup(() => document.removeEventListener("keydown", onKey, true));
  });

  let lastOpen = false;
  createEffect(() => {
    const isOpen = props.open;
    if (isOpen && !lastOpen) {
      previousFocus = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        if (!modalRef) return;
        // An explicit `autofocus` child wins (e.g. the confirm button of
        // ConfirmDialog, so ⏎ confirms). The native attribute alone is
        // ignored for elements inserted while something else has focus.
        const first =
          modalRef.querySelector<HTMLElement>("[autofocus]:not([disabled])") ??
          modalRef.querySelector<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
        first?.focus();
      });
    } else if (!isOpen && lastOpen) {
      try {
        previousFocus?.focus?.();
      } catch {
        /* element gone */
      }
    }
    lastOpen = isOpen;
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && (props.closeOnBackdrop ?? true)) {
              closeWithFlush();
            }
          }}
        >
          <div
            ref={modalRef}
            class="modal"
            role="dialog"
            aria-modal="true"
            aria-label={props.title}
            style={
              props.maxWidth ? `max-width:${props.maxWidth}px;width:min(${props.maxWidth}px,92vw)` : ""
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Show when={props.title}>
              <div class="modal-head">
                <h2>{props.title}</h2>
                <button
                  class="modal-close"
                  type="button"
                  aria-label={t("modal.close.aria")}
                  title={t("modal.close.title")}
                  onClick={closeWithFlush}
                >
                  ✕
                </button>
              </div>
            </Show>
            <div class="modal-body">{props.children}</div>
            <Show when={props.footer}>
              <div class="modal-footer">{props.footer}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
