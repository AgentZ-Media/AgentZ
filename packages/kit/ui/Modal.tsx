import { JSX, Show, createEffect, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../i18n";
import { FOCUSABLE, trapTab } from "./focusTrap";
import "./Modal.css";

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title?: string;
  /** Accessible name when the dialog renders its own heading instead of `title`. */
  label?: string;
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
      trapTab(e, modalRef, Array.from(modalRef.querySelectorAll<HTMLElement>(FOCUSABLE)));
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
          modalRef.querySelector<HTMLElement>(FOCUSABLE);
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
            aria-label={props.label ?? props.title}
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
