import { uiStore } from "../../../stores/ui";
import { For, Show, createSignal, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "@agentz/kit/ui";
import { dismissOnDialog } from "@agentz/kit/ui";
import { t } from "../../../i18n";
import type { Folder } from "../../../lib/types";
import { folderColor } from "../folderColor";
import "./FolderMenu.css";

// Folder picker: a trigger (chip or ghost button) plus a `.menu` popover
// with "Kein Ordner" and every folder (colour dot + check). Used by the
// open idea row, the capture field, the selection bar and the quick-capture
// footer.
// Keyboard: ↑/↓ move, ⏎ picks, esc closes (and marks the event handled so
// a surrounding dialog stays open).

export interface FolderMenuProps {
  folders: Folder[];
  value: string | null;
  onChange(folderId: string | null): void;
  /** "chip" shows the current folder; "ghost" shows `label` as a ghost button. */
  variant?: "chip" | "ghost";
  /** Fixed trigger text for the ghost variant (e.g. "In Ordner …"). */
  label?: string;
  class?: string;
  disabled?: boolean;
  /** Accessible name of the trigger. */
  ariaLabel?: string;
}

export function FolderMenu(props: FolderMenuProps) {
  const [open, setOpen] = createSignal(false);
  const [active, setActive] = createSignal(0);
  const [pos, setPos] = createSignal<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  let trigger: HTMLButtonElement | undefined;
  let menu: HTMLDivElement | undefined;

  const options = () => [
    { id: null as string | null, name: t("ideasPage.folder.none") },
    ...props.folders.map((f) => ({ id: f.id as string | null, name: f.name })),
  ];
  const current = () => props.folders.find((f) => f.id === props.value) ?? null;

  function place() {
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const estHeight = Math.min(320, options().length * 32 + 12);
    const left = Math.min(r.left, window.innerWidth - 256);
    if (r.bottom + 6 + estHeight > window.innerHeight - 8) {
      setPos({ left, bottom: window.innerHeight - r.top + 6 });
    } else {
      setPos({ left, top: r.bottom + 6 });
    }
  }

  function openMenu() {
    if (props.disabled) return;
    place();
    const idx = options().findIndex((o) => o.id === props.value);
    setActive(Math.max(0, idx));
    setOpen(true);
    queueMicrotask(() => menu?.focus());
  }
  function close(refocus = true) {
    setOpen(false);
    if (refocus) trigger?.focus();
  }
  function pick(idx: number) {
    const opt = options()[idx];
    close();
    if (opt && opt.id !== props.value) props.onChange(opt.id);
  }

  function onMenuKey(e: KeyboardEvent) {
    const n = options().length;
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
    } else if (e.key === "Escape") {
      // preventDefault marks it handled for DialogFrame; stopPropagation
      // keeps page-level handlers out.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      e.preventDefault();
      close();
    }
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
  const onReflow = () => {
    if (open()) close(false);
  };
  document.addEventListener("mousedown", onDocDown, true);
  window.addEventListener("resize", onReflow);
  onCleanup(() => {
    document.removeEventListener("mousedown", onDocDown, true);
    window.removeEventListener("resize", onReflow);
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class={`${props.variant === "ghost" ? "btn ghost" : "chip fm-chip"}${props.class ? ` ${props.class}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => (open() ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <Show
          when={props.variant === "ghost"}
          fallback={
            <>
              <Show when={current()} fallback={<Icon name="folder" />}>
                {(f) => <i class="fdot" style={{ "--dot": folderColor(f().id) }} />}
              </Show>
              <span class="fm-name">{current()?.name ?? t("ideasPage.folder.none")}</span>
              <Icon name="down" />
            </>
          }
        >
          {props.label ?? t("ideasPage.folder.move")}
        </Show>
      </button>
      <Show when={open()}>
        <Portal>
          <div
            ref={menu}
            class="menu fm-menu" data-dialog-dismiss-layer
            role="listbox"
            tabindex="-1"
            aria-label={props.ariaLabel ?? t("ideasPage.folder.label")}
            style={{
              left: `${pos().left}px`,
              top: pos().top !== undefined ? `${pos().top}px` : undefined,
              bottom: pos().bottom !== undefined ? `${pos().bottom}px` : undefined,
            }}
            onKeyDown={onMenuKey}
          >
            <For each={options()}>
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
                  <Show when={opt.id} fallback={<Icon name="folder" />}>
                    {(id) => <i class="fdot" style={{ "--dot": folderColor(id()) }} />}
                  </Show>
                  <span class="lbl">{opt.name}</span>
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
