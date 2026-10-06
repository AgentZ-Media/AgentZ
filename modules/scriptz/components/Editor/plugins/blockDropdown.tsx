import { uiStore } from "../../../stores/ui";
import { createSignal, For, onCleanup as solidOnCleanup } from "solid-js";
import { render } from "solid-js/web";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  BLOCK_HOTKEYS,
  BLOCK_TYPES,
  blockLabel,
  BLOCK_FACTORY,
  findScriptzAncestor,
} from "../nodes";
import type { BlockType } from "../../../lib/types";
import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";
import { dismissOnDialog, focusWithin } from "@agentz/kit/ui";

interface DropdownProps {
  x: number;
  y: number;
  current: BlockType | null;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  /** Closes without refocusing the editor (a dialog took over). */
  onDismiss: () => void;
  /** The editor's root element: keys only count while focus is in it. */
  root: () => HTMLElement | null;
}

function BlockDropdown(props: DropdownProps) {
  const [index, setIndex] = createSignal(
    Math.max(0, BLOCK_TYPES.findIndex((t) => t === props.current)),
  );

  // The picker keeps the caret (focus) in the editor. A dialog opening on
  // top - or focus leaving the editor otherwise - closes it, so Enter or
  // the arrows typed into the dialog never change the block behind it.
  dismissOnDialog({
    dialogOpen: uiStore.anyDialogOpen,
    open: () => true,
    inside: (node) => {
      if (props.root()?.contains(node)) return true;
      const el = node instanceof Element ? node : node.parentElement;
      return !!el?.closest(".scriptz-block-dropdown");
    },
    dismiss: () => props.onDismiss(),
  });

  const onKey = (e: KeyboardEvent) => {
    if (!focusWithin(props.root())) return;
    // stopImmediatePropagation IN ADDITION to preventDefault: Lexical hangs its
    // own keydown listener on the editor root and dispatches
    // KEY_ENTER_COMMAND / arrow-key caret movement from there. preventDefault
    // alone only suppresses the browser default action — Lexical would still
    // receive the event and additionally fire smartEnter on Enter (= a new
    // line on confirm from the dropdown). We kill propagation completely
    // here.
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopImmediatePropagation();
      setIndex((i) => (i + 1) % BLOCK_TYPES.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopImmediatePropagation();
      setIndex((i) => (i - 1 + BLOCK_TYPES.length) % BLOCK_TYPES.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopImmediatePropagation();
      const t = BLOCK_TYPES[index()];
      if (t) props.onSelect(t);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      props.onClose();
    }
  };

  const onDocClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (target && target.closest(".scriptz-block-dropdown")) return;
    props.onClose();
  };

  document.addEventListener("keydown", onKey, true);
  document.addEventListener("mousedown", onDocClick, true);
  solidOnCleanup(() => {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDocClick, true);
  });

  return (
    <div
      class="scriptz-block-dropdown"
      role="listbox"
      aria-label={t("script.picker.aria")}
      style={{
        position: "fixed",
        left: `${clampX(props.x)}px`,
        top: `${props.y}px`,
        "z-index": 50,
      }}
    >
      <For each={BLOCK_TYPES}>
        {(type, i) => (
          <div
            class="scriptz-bd-item"
            classList={{ "is-active": i() === index(), "is-current": type === props.current }}
            role="option"
            aria-selected={i() === index()}
            onMouseEnter={() => setIndex(i())}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onSelect(type);
            }}
          >
            <span class="scriptz-bd-label">{blockLabel(type)}</span>
            <kbd class="scriptz-bd-hint" aria-hidden="true">
              {K(BLOCK_HOTKEYS[type])}
            </kbd>
          </div>
        )}
      </For>
    </div>
  );
}

const PICKER_WIDTH = 200;

function clampX(x: number): number {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  return Math.max(8, Math.min(x, vw - PICKER_WIDTH - 8));
}

export function installBlockDropdown(
  editor: LexicalEditor,
  host: HTMLElement,
): () => void {
  let dispose: (() => void) | null = null;
  let container: HTMLDivElement | null = null;

  const close = (refocus = true) => {
    if (dispose) dispose();
    dispose = null;
    if (container && container.parentNode) container.parentNode.removeChild(container);
    container = null;
    // Refocus the editor so typing continues normally.
    if (refocus) queueMicrotask(() => editor.focus());
  };

  const open = (x: number, y: number, current: BlockType | null) => {
    close();
    container = document.createElement("div");
    host.appendChild(container);
    const onSelect = (type: BlockType) => {
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const block = findScriptzAncestor(sel.anchor.getNode());
        if (!block) return;
        if (block.getType() === type) return;
        const next = BLOCK_FACTORY[type]();
        // Move all children into the new block (preserve text/format).
        // AGENTS.md: empty blocks must stay CHILDLESS — Lexical injects a
        // managed <br> placeholder; pre-seeding $createTextNode("") breaks
        // caret placement in WebKit.
        for (const child of block.getChildren()) {
          next.append(child);
        }
        block.replace(next);
        if (next.getChildrenSize() > 0) {
          next.selectEnd();
        } else {
          next.select(0, 0);
        }
      });
      close();
    };
    dispose = render(
      () => (
        <BlockDropdown
          x={x}
          y={y}
          current={current}
          onSelect={onSelect}
          onClose={close}
          onDismiss={() => close(false)}
          root={() => editor.getRootElement()}
        />
      ),
      container,
    );
  };

  const unregister = editor.registerCommand<KeyboardEvent>(
    KEY_TAB_COMMAND,
    (event) => {
      // Shift+Tab is reserved for outdent / future use; only plain Tab opens it.
      if (event.shiftKey) return false;

      let coords: { x: number; y: number } | null = null;
      let current: BlockType | null = null;

      editor.getEditorState().read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const block = findScriptzAncestor(sel.anchor.getNode());
        if (!block) return;
        current = block.getBlockType();
      });

      const dom = window.getSelection();
      if (dom && dom.rangeCount > 0) {
        const rect = dom.getRangeAt(0).getBoundingClientRect();
        if (rect.width || rect.height || rect.x || rect.y) {
          coords = { x: rect.left, y: rect.bottom + 4 };
        }
      }
      if (!coords) {
        const r = host.getBoundingClientRect();
        coords = { x: r.left + 16, y: r.top + 16 };
      }

      event.preventDefault();
      open(coords.x, coords.y, current);
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );

  return () => {
    unregister();
    close();
  };
}
