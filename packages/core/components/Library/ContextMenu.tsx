import { createSignal, onCleanup, onMount, For, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon, type IconName } from "../Common/Icon";

/**
 * Floating menu in the design-system look (`.menu` / `.menu-it`). Used for
 * row context menus, the "⋯" buttons, the sort / grouping pickers and the
 * sidebar folder menu. Moved here from `Browser/ScriptContextMenu` with the
 * same item shape plus a few presentational extras.
 */
export interface ContextMenuItem {
  label: string;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Presence of `children` turns the row into a submenu trigger. */
  children?: ContextMenuItem[];
  /** Kept for API compatibility with the old browser menu. */
  hasSubmenu?: boolean;
  /** Leading icon from the design set, or any element (e.g. a stage glyph). */
  icon?: IconName | JSX.Element;
  /** Shows a check mark on the right (current sort / group / stage). */
  checked?: boolean;
  /** Keyboard hint on the right (already formatted, e.g. "⏎"). */
  hint?: string;
  /** Draws a separator line above this item. */
  separatorBefore?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  items: ContextMenuItem[];
  /** "end": `x` is the right edge of the menu (anchored under a button on
   *  the right). "above": `y` is the bottom edge (bars at the window bottom). */
  align?: "start" | "end";
  placement?: "below" | "above";
  /** Optional width override in px. */
  width?: number;
}

const DEFAULT_W = 244;
const MARGIN = 8;

function itemsOf(root: HTMLElement | undefined): HTMLButtonElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLButtonElement>(":scope > .menu-it:not(:disabled)"));
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{ left: number; top: number } | null>(null);
  const width = () => props.width ?? DEFAULT_W;

  const onDocDown = (e: MouseEvent) => {
    // Submenus live in their own Portal, so check by class: any menu surface
    // counts as "inside".
    const target = e.target as HTMLElement | null;
    if (target?.closest(".ctx-pop")) return;
    props.onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Focus inside an open submenu: its own handler moves the focus.
      const active = document.activeElement;
      if (active && active !== document.body && !menuRef?.contains(active)) return;
      const list = itemsOf(menuRef);
      if (list.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = list.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "ArrowDown"
          ? (idx + 1 + list.length) % list.length
          : (idx - 1 + list.length) % list.length;
      list[idx === -1 && e.key === "ArrowUp" ? list.length - 1 : next]?.focus();
    }
  };

  onMount(() => {
    // Measure after render and clamp into the viewport.
    const h = menuRef?.offsetHeight ?? 0;
    const w = width();
    let left = props.align === "end" ? props.x - w : props.x;
    let top = props.placement === "above" ? props.y - h : props.y;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    setPos({ left, top });

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onDocDown, true);
      document.addEventListener("contextmenu", onDocDown, true);
    }, 0);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", props.onClose);
    onCleanup(() => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("contextmenu", onDocDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", props.onClose);
    });
  });

  return (
    <Portal>
      <div
        ref={menuRef}
        class="menu ctx-pop"
        role="menu"
        style={{
          width: `${width()}px`,
          left: `${pos()?.left ?? props.x}px`,
          top: `${pos()?.top ?? props.y}px`,
          visibility: pos() ? "visible" : "hidden",
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <For each={props.items}>
          {(item) => <MenuRow item={item} onChoose={() => props.onClose()} width={width()} />}
        </For>
      </div>
    </Portal>
  );
}

/** Back-compat name of the old browser component. */
export const ScriptContextMenu = ContextMenu;

function ItemIcon(props: { icon: IconName | JSX.Element | undefined }) {
  return (
    <Show when={props.icon !== undefined}>
      {typeof props.icon === "string" ? <Icon name={props.icon as IconName} size={14} /> : props.icon}
    </Show>
  );
}

function MenuRow(props: { item: ContextMenuItem; onChoose: () => void; width: number }) {
  let rowRef: HTMLButtonElement | undefined;
  let subRef: HTMLDivElement | undefined;
  const [openSub, setOpenSub] = createSignal(false);
  const [subPos, setSubPos] = createSignal<{ x: number; y: number } | null>(null);

  // A short grace period before hiding lets the cursor cross the gap
  // between the row and its submenu.
  let hideTimer: number | null = null;
  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const scheduleHide = () => {
    cancelHide();
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      setOpenSub(false);
    }, 140);
  };
  onCleanup(cancelHide);

  const hasSub = () => (props.item.children?.length ?? 0) > 0;

  const showSub = () => {
    if (!hasSub() || !rowRef) return;
    cancelHide();
    const rect = rowRef.getBoundingClientRect();
    let x = rect.right + 2;
    if (x + props.width + MARGIN > window.innerWidth) {
      x = Math.max(MARGIN, rect.left - props.width - 2);
    }
    const subH = (props.item.children?.length ?? 0) * 32 + 12;
    let y = rect.top - 5;
    if (y + subH + MARGIN > window.innerHeight) {
      y = Math.max(MARGIN, window.innerHeight - subH - MARGIN);
    }
    setSubPos({ x, y });
    setOpenSub(true);
  };

  const handleClick = () => {
    if (props.item.disabled) return;
    if (hasSub()) {
      if (openSub()) {
        cancelHide();
        setOpenSub(false);
      } else {
        showSub();
        queueMicrotask(() => subRef?.querySelector<HTMLButtonElement>(".menu-it:not(:disabled)")?.focus());
      }
      return;
    }
    props.item.onClick?.();
    props.onChoose();
  };

  return (
    <>
      <Show when={props.item.separatorBefore}>
        <div class="menu-sep" role="separator" />
      </Show>
      <button
        ref={rowRef}
        type="button"
        class="menu-it"
        classList={{ danger: !!props.item.danger, on: openSub() }}
        role="menuitem"
        aria-haspopup={hasSub() ? "menu" : undefined}
        aria-expanded={hasSub() ? openSub() : undefined}
        disabled={props.item.disabled}
        onMouseEnter={() => {
          cancelHide();
          if (hasSub()) showSub();
        }}
        onMouseLeave={() => {
          if (hasSub()) scheduleHide();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" && hasSub()) {
            e.preventDefault();
            e.stopPropagation();
            showSub();
            queueMicrotask(() => subRef?.querySelector<HTMLButtonElement>(".menu-it:not(:disabled)")?.focus());
          }
        }}
        onClick={handleClick}
      >
        <ItemIcon icon={props.item.icon} />
        <span class="lbl">{props.item.label}</span>
        <Show when={props.item.checked}>
          <span class="ck">
            <Icon name="check" size={14} />
          </span>
        </Show>
        <Show when={!props.item.checked && props.item.hint}>
          <kbd>{props.item.hint}</kbd>
        </Show>
        <Show when={hasSub()}>
          <span class="ctx-chev" aria-hidden="true">
            <Icon name="right" size={12} />
          </span>
        </Show>
      </button>
      <Show when={openSub() && subPos()}>
        {(p) => (
          <Portal>
            <div
              ref={subRef}
              class="menu ctx-pop"
              role="menu"
              style={{ width: `${props.width}px`, left: `${p().x}px`, top: `${p().y}px` }}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpenSub(false);
                  rowRef?.focus();
                  return;
                }
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  const list = itemsOf(subRef);
                  if (list.length === 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const idx = list.indexOf(document.activeElement as HTMLButtonElement);
                  const n = list.length;
                  list[e.key === "ArrowDown" ? (idx + 1) % n : (idx - 1 + n) % n]?.focus();
                }
              }}
            >
              <For each={props.item.children}>
                {(child) => <MenuRow item={child} onChoose={props.onChoose} width={props.width} />}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}

export default ContextMenu;
