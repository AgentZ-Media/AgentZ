import { createSignal, For, onCleanup as solidOnCleanup } from "solid-js";
import { render } from "solid-js/web";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  BaseScriptzNode,
  BLOCK_HOTKEYS,
  BLOCK_TYPES,
  blockLabel,
  $createScriptzActionNode,
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
} from "../nodes";
import type { BlockType } from "../../../lib/types";
import { K } from "../../../lib/keys";

function findScriptzAncestor(node: LexicalNode | null): BaseScriptzNode | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if (cur instanceof BaseScriptzNode) return cur;
    cur = cur.getParent();
  }
  return null;
}

function createBlockOfType(type: BlockType): BaseScriptzNode {
  switch (type) {
    case "scriptz-action":
      return $createScriptzActionNode();
    case "scriptz-character":
      return $createScriptzCharacterNode();
    case "scriptz-dialog":
      return $createScriptzDialogNode();
  }
}

interface DropdownProps {
  x: number;
  y: number;
  current: BlockType | null;
  onSelect: (type: BlockType) => void;
  onClose: () => void;
}

function BlockDropdown(props: DropdownProps) {
  const [index, setIndex] = createSignal(
    Math.max(0, BLOCK_TYPES.findIndex((t) => t === props.current)),
  );

  const onKey = (e: KeyboardEvent) => {
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
      style={{
        position: "fixed",
        left: `${props.x}px`,
        top: `${props.y}px`,
        "z-index": 50,
        background: "var(--modal-bg)",
        color: "var(--fg)",
        border: "1px solid var(--border)",
        "border-radius": "var(--r-3)",
        "box-shadow": "var(--shadow-popover)",
        padding: "4px",
        "min-width": "180px",
        "font-family": "var(--font-sans)",
        "font-size": "var(--fs-13)",
      }}
    >
      <For each={BLOCK_TYPES}>
        {(type, i) => (
          <div
            classList={{ "scriptz-bd-item": true, "is-active": i() === index() }}
            style={{
              padding: "6px 10px",
              "border-radius": "var(--r-2)",
              cursor: "pointer",
              background: i() === index() ? "var(--selected)" : "transparent",
            }}
            onMouseEnter={() => setIndex(i())}
            onMouseDown={(e) => {
              e.preventDefault();
              props.onSelect(type);
            }}
          >
            <span>{blockLabel(type)}</span>
            <span
              class="scriptz-bd-hint"
              aria-hidden="true"
              style={{ float: "right", opacity: 0.55, "margin-left": "16px" }}
            >
              {K(BLOCK_HOTKEYS[type])}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

export function installBlockDropdown(
  editor: LexicalEditor,
  host: HTMLElement,
): () => void {
  let dispose: (() => void) | null = null;
  let container: HTMLDivElement | null = null;

  const close = () => {
    if (dispose) dispose();
    dispose = null;
    if (container && container.parentNode) container.parentNode.removeChild(container);
    container = null;
    // Refocus the editor so typing continues normally.
    queueMicrotask(() => editor.focus());
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
        const next = createBlockOfType(type);
        // Move all children into the new block (preserve text/format).
        // CLAUDE.md: empty blocks must stay CHILDLESS — Lexical injects a
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
