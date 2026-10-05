import { createSignal, For, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import {
  BaseScriptzNode,
  $createScriptzDialogNode,
  $isScriptzCharacterNode,
  type ScriptzCharacterNode,
} from "../nodes";
import {
  rankNextSpeakers,
  previousCharacterFrom,
} from "../predict";
import type { ScriptCharacter } from "../../../lib/types";
import { K } from "@agentz/kit/platform";
import { t } from "../../../i18n";

const DROPDOWN_WIDTH = 236;

function findCharacterAncestor(
  node: LexicalNode | null,
): ScriptzCharacterNode | null {
  let cur: LexicalNode | null = node;
  while (cur) {
    if ($isScriptzCharacterNode(cur)) return cur;
    cur = cur instanceof BaseScriptzNode ? null : cur.getParent();
  }
  return null;
}

export interface InstallCharacterDropdownArgs {
  scriptCharacters: () => ScriptCharacter[];
  /** Open the colour picker for an existing character, anchored at a
   * viewport coordinate. Wired to the colour dot in each dropdown row. */
  openColorPicker?: (name: string, anchor: { x: number; y: number }) => void;
}

export function installCharacterDropdown(
  editor: LexicalEditor,
  host: HTMLElement,
  getArgs: () => InstallCharacterDropdownArgs,
): () => void {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal({ x: 0, y: 0 });
  const [filter, setFilter] = createSignal("");
  // While the writer is typing, auto-highlight the first matching suggestion
  // so a partial like "A" lights up "AXEL" and Enter accepts it. An empty
  // line stays at -1 so Enter falls through to smartEnter (advance to Dialog).
  // -1 also covers "no matches at all" — Enter then advances normally and the
  // freshly-typed name is committed when the cursor leaves the block.
  const [activeIdx, setActiveIdx] = createSignal(-1);
  const [activeKey, setActiveKey] = createSignal<string | null>(null);
  // Computed once per update from inside `editor.read()` (we need access
  // to `previousCharacterFrom` which walks Lexical state). Holds the
  // characters in predict-ranked order: most-likely-next-speaker first,
  // previous speaker pushed to the tail.
  const [rankedList, setRankedList] = createSignal<ScriptCharacter[]>([]);
  // Name (uppercase) of the predicted next speaker - labelled "ist dran".
  // Null when the only candidate is the previous speaker.
  const [predicted, setPredicted] = createSignal<string | null>(null);

  const filteredEntries = (): ScriptCharacter[] => {
    const q = filter().trim().toUpperCase();
    const list = rankedList();
    if (!q) return list;
    return list.filter((e) => e.name.toUpperCase().includes(q));
  };

  // Centered under the character line. The x coordinate
  // is the line's centre; the view shifts itself by -50 % and is clamped
  // so it never leaves the window.
  const positionFromCursor = (nodeKey: string | null): { x: number; y: number } => {
    if (nodeKey) {
      const el = editor.getElementByKey(nodeKey);
      if (el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom + 4 };
      }
    }
    const dom = window.getSelection();
    if (dom && dom.rangeCount > 0) {
      const rect = dom.getRangeAt(0).getBoundingClientRect();
      if (rect.width || rect.height || rect.left || rect.top) {
        return { x: rect.left, y: rect.bottom + 6 };
      }
    }
    const r = host.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 60 };
  };

  const clampedX = (x: number) => {
    const half = DROPDOWN_WIDTH / 2;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    return Math.max(half + 8, Math.min(x, vw - half - 8));
  };

  const close = () => {
    setOpen(false);
    setActiveKey(null);
  };

  const applySelection = (entry: ScriptCharacter, advance: boolean) => {
    const key = activeKey();
    if (!key) return;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!node || !$isScriptzCharacterNode(node)) return;
      node.setCharacterName(entry.name.toUpperCase());
      const children = node.getChildren();
      for (const c of children) c.remove();
      node.append($createTextNode(entry.name.toUpperCase()));
      if (advance) {
        // Mirror smartEnter's character → dialog transition so picking a
        // suggestion drops the writer straight into the dialog line.
        const next = $createScriptzDialogNode();
        node.insertAfter(next);
        next.select(0, 0);
      } else {
        node.selectEnd();
      }
    });
    close();
  };

  const container = document.createElement("div");
  container.className = "scriptz-char-dd-host";
  host.appendChild(container);

  function DropdownView() {
    return (
      <Show when={open() && filteredEntries().length > 0}>
        <div
          class="scriptz-character-dropdown"
          role="listbox"
          aria-label={t("script.ac.aria")}
          style={{
            position: "fixed",
            left: `${clampedX(pos().x)}px`,
            top: `${pos().y}px`,
            transform: "translateX(-50%)",
            "z-index": 50,
          }}
          onMouseDown={(ev) => ev.preventDefault()}
        >
          <For each={filteredEntries()}>
            {(entry, i) => (
              <div
                class="scriptz-ac-it"
                classList={{ on: i() === activeIdx() }}
                role="option"
                aria-selected={i() === activeIdx()}
                onMouseEnter={() => setActiveIdx(i())}
                onMouseDown={(ev) => {
                  ev.preventDefault();
                  applySelection(entry, true);
                }}
              >
                <button
                  type="button"
                  class="scriptz-ac-dot scriptz-color-picker-trigger"
                  aria-label={t("charDropdown.colorAria", { name: entry.name })}
                  title={t("charDropdown.colorAria", { name: entry.name })}
                  style={{ background: entry.color }}
                  onMouseDown={(ev) => {
                    // Beat the row's mouseDown (which would commit the
                    // entry). We just want to open the picker.
                    ev.preventDefault();
                    ev.stopPropagation();
                    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                    getArgs().openColorPicker?.(entry.name, {
                      x: r.right + 8,
                      y: r.top,
                    });
                  }}
                />
                <b>{entry.name.toUpperCase()}</b>
                <Show when={predicted() === entry.name.toUpperCase()}>
                  <small>{t("script.ac.next")}</small>
                </Show>
                <Show when={i() === activeIdx()}>
                  <kbd>{K("Enter")}</kbd>
                </Show>
              </div>
            )}
          </For>
          <div class="scriptz-ac-foot">{t("script.ac.newName")}</div>
        </div>
      </Show>
    );
  }

  const dispose = render(() => <DropdownView />, container);

  const teardownUpdate = editor.registerUpdateListener(({ editorState }) => {
    let nodeKey: string | null = null;
    let text = "";
    let ranked: ScriptCharacter[] = [];
    let prevSpeakerUpper: string | null = null;
    editorState.read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) return;
      const charNode = findCharacterAncestor(sel.anchor.getNode());
      if (!charNode) return;
      nodeKey = charNode.getKey();
      text = charNode.getTextContent();
      // Sort the autocomplete entries by likelihood-of-being-next-speaker
      // so the visual order matches the prediction (top entry = most
      // likely, previous speaker pushed to the tail).
      const prev = previousCharacterFrom(charNode);
      prevSpeakerUpper = prev ? prev.toUpperCase() : null;
      const candidates = getArgs().scriptCharacters();
      ranked = rankNextSpeakers(prev, candidates);
    });

    if (!nodeKey) {
      if (open()) close();
      return;
    }

    setActiveKey(nodeKey);
    setFilter(text);
    setRankedList(ranked);
    const head = ranked[0];
    setPredicted(head && head.name.toUpperCase() !== prevSpeakerUpper ? head.name.toUpperCase() : null);
    setPos(positionFromCursor(nodeKey));

    // Highlight resolution:
    //  - typed prefix → first matching entry (filtered list is still in
    //    predict order, so this is also the most plausible match).
    //  - empty + the top-ranked entry is a "real" next speaker
    //    suggestion (i.e. not just the previous speaker because no one
    //    else exists) → highlight it so Enter accepts.
    //  - otherwise → -1, so Enter falls through to smartEnter and
    //    advances to a fresh Dialog block instead of picking a name.
    const trimmed = text.trim();
    const list = filteredEntries();
    if (list.length === 0) {
      setActiveIdx(-1);
    } else if (trimmed.length > 0) {
      setActiveIdx(0);
    } else {
      const top = list[0];
      const isRealSuggestion =
        top != null && top.name.toUpperCase() !== prevSpeakerUpper;
      setActiveIdx(isRealSuggestion ? 0 : -1);
    }
    setOpen(true);
  });

  // While the dropdown is open, the page (or any scrollable ancestor) can
  // scroll under it. Because `pos` is in viewport coords (`position: fixed`)
  // and is only refreshed on Lexical updates, scrolling without typing would
  // leave the dropdown glued to the original viewport spot while the
  // anchored character block drifts. Re-anchor on every scroll/resize so the
  // dropdown follows its character line.
  const reanchor = () => {
    if (!open()) return;
    setPos(positionFromCursor(activeKey()));
  };
  window.addEventListener("scroll", reanchor, true);
  window.addEventListener("resize", reanchor);

  const onKey = (ev: KeyboardEvent) => {
    if (!open()) return;
    // Only while the caret is actually in the editor: the selection stays in
    // the character block when focus moves to a dialog (⌘I, ⌘K) or the
    // colour popover, and Enter / arrows there must not pick a name.
    const root = editor.getRootElement();
    const active = document.activeElement;
    if (!root || !active || !root.contains(active)) return;
    const list = filteredEntries();
    if (list.length === 0) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIdx((i) => (i < 0 ? 0 : (i + 1) % list.length));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIdx((i) => (i < 0 ? list.length - 1 : (i - 1 + list.length) % list.length));
    } else if (ev.key === "Enter") {
      const idx = activeIdx();
      if (idx < 0) return; // No active suggestion → let smartEnter advance.
      const entry = list[idx];
      if (!entry) return;
      ev.preventDefault();
      ev.stopPropagation();
      applySelection(entry, true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey, true);

  return () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", reanchor, true);
    window.removeEventListener("resize", reanchor);
    teardownUpdate();
    dispose();
    if (container.parentNode) container.parentNode.removeChild(container);
  };
}
