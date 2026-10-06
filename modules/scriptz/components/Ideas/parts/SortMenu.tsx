import { uiStore } from "../../../stores/ui";
import { For, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "@agentz/kit/ui";
import { dismissOnDialog } from "@agentz/kit/ui";
import "../../Common/FolderMenu.css";

// Small option menu behind a ghost button ("Neueste zuerst ▾"). Same
// keyboard model as FolderMenu.

export interface SortMenuProps<T extends string> {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange(id: T): void;
  ariaLabel: string;
}

export function SortMenu<T extends string>(props: SortMenuProps<T>) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [pos, setPos] = createSignal({ top: 0, right: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const currentLabel = () => props.options.find((o) => o.id === props.value)?.label ?? "";

  function openMenu() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    setActive(Math.max(0, props.options.findIndex((o) => o.id === props.value)));
    setOpen(true);
    queueMicrotask(() => menu?.focus());
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger?.focus();
  }
  function pick(i: number) {
    const opt = props.options[i];
    close();
    if (opt) props.onChange(opt.id);
  }

  // A dialog opening on top closes the menu instead of leaving it open
  // (and focusable) behind the scrim.
  dismissOnDialog({
    dialogOpen: uiStore.anyDialogOpen,
    open,
    inside: (node) => !!(trigger?.contains(node) || menu?.contains(node)),
    dismiss: () => close(false),
  });

  const onDocDown = (e: MouseEvent) => {
    if (!open()) return;
    const target = e.target as Node;
    if (trigger?.contains(target) || menu?.contains(target)) return;
    close(false);
  };
  document.addEventListener("mousedown", onDocDown, true);
  onCleanup(() => document.removeEventListener("mousedown", onDocDown, true));

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="btn ghost"
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={props.ariaLabel}
        onClick={() => (open() ? close() : openMenu())}
      >
        {currentLabel()}
        <Icon name="down" size={12} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="menu fm-menu" data-dialog-dismiss-layer
            role="listbox"
            tabindex="-1"
            aria-label={props.ariaLabel}
            style={{ top: `${pos().top}px`, right: `${pos().right}px`, width: "200px" }}
            onKeyDown={(e) => {
              const n = props.options.length;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => (i + 1) % n);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => (i - 1 + n) % n);
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                pick(active());
              } else if (e.key === "Escape" || e.key === "Tab") {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            }}
          >
            <For each={props.options}>
              {(opt, i) => (
                <div
                  class="menu-it"
                  classList={{ on: i() === active() }}
                  role="option"
                  aria-selected={opt.id === props.value}
                  onMouseEnter={() => setActive(i())}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(i());
                  }}
                >
                  <span class="lbl">{opt.label}</span>
                  <Show when={opt.id === props.value}>
                    <span class="ck">
                      <Icon name="check" size={13} />
                    </span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
