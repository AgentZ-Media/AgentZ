// Bridge between the agent and the mounted Lexical editor of a script:
// read live blocks (incl. unsaved typing), read the selection as block
// indices, preview and apply proposals. Applying is a normal editor update,
// so autosave and undo (⌘Z) work as for typing.

import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { BLOCK_FACTORY, BaseScriptzNode } from "../Editor/nodes";
import { blockTypeOf, type AgentBlock } from "../../lib/agent/scriptText";
import { resolveTarget, type ProposalTarget } from "../../lib/agent/proposals";

const editors = new Map<string, LexicalEditor>();

export function registerAgentEditor(scriptId: string, editor: LexicalEditor): () => void {
  editors.set(scriptId, editor);
  return () => {
    if (editors.get(scriptId) === editor) editors.delete(scriptId);
  };
}

export function agentEditor(scriptId: string | null): LexicalEditor | null {
  return scriptId ? editors.get(scriptId) ?? null : null;
}

export function liveBlocks(scriptId: string | null): AgentBlock[] | null {
  const editor = agentEditor(scriptId);
  if (!editor) return null;
  const out: AgentBlock[] = [];
  editor.getEditorState().read(() => {
    for (const child of $getRoot().getChildren()) {
      out.push({ type: blockTypeOf(child.getType()), text: child.getTextContent() });
    }
  });
  // A trailing empty block is the caret placeholder, not content.
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  return out;
}

function topIndex(node: LexicalNode): number {
  const top = node.getParent() === null ? node : node.getTopLevelElement();
  return top ? top.getIndexWithinParent() : -1;
}

export interface BlockSelection {
  from: number;
  to: number;
  text: string;
}

/** Non-collapsed selection as block range + selected text. */
export function readSelection(scriptId: string | null): BlockSelection | null {
  const editor = agentEditor(scriptId);
  if (!editor) return null;
  let result: BlockSelection | null = null;
  editor.getEditorState().read(() => {
    const sel = $getSelection();
    if (!$isRangeSelection(sel) || sel.isCollapsed()) return;
    const a = topIndex(sel.anchor.getNode());
    const b = topIndex(sel.focus.getNode());
    if (a < 0 || b < 0) return;
    const text = sel.getTextContent().trim();
    if (!text) return;
    result = { from: Math.min(a, b), to: Math.max(a, b), text };
  });
  return result;
}

function buildNode(block: AgentBlock): BaseScriptzNode {
  const node = BLOCK_FACTORY[`scriptz-${block.type}`]();
  // Empty blocks stay childless (WebKit caret invariant, see AGENTS.md).
  if (block.text) node.append($createTextNode(block.text));
  return node;
}

/** Inserts or replaces blocks and returns the target as actually applied
 *  (it follows lines that moved). Null when the targeted lines changed or
 *  vanished since the proposal was made. */
export function applyBlocks(scriptId: string, blocks: readonly AgentBlock[], proposed: ProposalTarget): ProposalTarget | null {
  const editor = agentEditor(scriptId);
  if (!editor || blocks.length === 0) return null;
  let applied: ProposalTarget | null = null;
  let inserted: string[] = [];
  editor.update(() => {
    const root = $getRoot();
    const children = root.getChildren();
    const target = resolveTarget(proposed, children.map((child) => child.getTextContent()));
    if (!target) return;
    const nodes = blocks.map(buildNode);
    inserted = nodes.map((node) => node.getKey());
    if (target.mode === "replace") {
      const first = children[target.from];
      for (const node of nodes) first.insertBefore(node);
      for (let i = target.from; i <= target.to; i++) children[i].remove();
      nodes[nodes.length - 1].selectEnd();
      applied = target;
      return;
    }
    if (target.mode === "insertAfter") {
      let after: LexicalNode = children[target.block];
      for (const node of nodes) {
        after.insertAfter(node);
        after = node;
      }
      (after as BaseScriptzNode).selectEnd();
      applied = target;
      return;
    }
    // Append: drop trailing empty blocks (as liveBlocks() ignores them)
    // instead of leaving a gap before the new lines.
    let last = root.getLastChild();
    while (last && !last.getTextContent().trim()) {
      const previous = last.getPreviousSibling();
      last.remove();
      last = previous;
    }
    for (const node of nodes) root.append(node);
    nodes[nodes.length - 1].selectEnd();
    applied = target;
  });
  // Hand the keyboard back to the paper so ⌘Z undoes the insert right away.
  if (applied && editor.getRootElement()) editor.focus();
  if (applied) markInserted(editor, inserted);
  return applied;
}

/** The new lines glow yellow for a moment, so it is clear what came in
 *  (components/Common/motion.css, `[data-ag-new]`). An attribute on the
 *  rendered element, never editor state. */
function markInserted(editor: LexicalEditor, keys: readonly string[]): void {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  requestAnimationFrame(() => {
    const elements = keys.map((key) => editor.getElementByKey(key)).filter((el): el is HTMLElement => !!el);
    for (const el of elements) el.setAttribute("data-ag-new", "");
    setTimeout(() => {
      for (const el of elements) el.removeAttribute("data-ag-new");
    }, 2600);
  });
}

/** Scrolls the block at `index` into view (after applying). */
export function revealBlock(scriptId: string, index: number): void {
  const editor = agentEditor(scriptId);
  if (!editor) return;
  editor.getEditorState().read(() => {
    const node = $getRoot().getChildAtIndex(index);
    if (!node) return;
    const el = editor.getElementByKey(node.getKey());
    requestAnimationFrame(() => el?.scrollIntoView({ block: "center", behavior: "smooth" }));
  });
}

/** Index of the first block a target touches (for revealing). */
export function targetIndex(scriptId: string, target: ProposalTarget, count: number): number {
  if (target.mode === "replace") return target.from;
  if (target.mode === "insertAfter") return target.block + 1;
  const editor = agentEditor(scriptId);
  let size = 0;
  editor?.getEditorState().read(() => { size = $getRoot().getChildrenSize(); });
  return Math.max(0, size - count);
}

// ---------------------------------------------------------------- preview

interface PreviewState {
  marked: HTMLElement[];
  spaced: HTMLElement | null;
  ghost: HTMLElement | null;
}
let preview: PreviewState | null = null;

/** Removes the proposal preview from the paper (hover ended, applied,
 *  chat closed). */
export function clearProposalPreview(): void {
  if (!preview) return;
  for (const el of preview.marked) el.removeAttribute("data-ag-preview");
  if (preview.spaced) {
    preview.spaced.removeAttribute("data-ag-ghost-after");
    preview.spaced.style.removeProperty("--ag-ghost-space");
  }
  preview.ghost?.remove();
  preview = null;
}

/** Shows a proposal on the paper without touching the script: the lines it
 *  replaces are struck through and the new lines appear dashed right where
 *  they would land. Only rendered DOM is touched (attributes and an
 *  overlay), never editor state. */
export function showProposalPreview(scriptId: string, target: ProposalTarget, blocks: readonly AgentBlock[], tag: string): void {
  clearProposalPreview();
  const editor = agentEditor(scriptId);
  const root = editor?.getRootElement();
  const sheet = root?.closest<HTMLElement>(".ss-sheet");
  if (!editor || !root || !sheet || blocks.length === 0) return;
  let keys: string[] = [];
  let resolved: ProposalTarget | null = null;
  editor.getEditorState().read(() => {
    const children = $getRoot().getChildren();
    keys = children.map((child) => child.getKey());
    resolved = resolveTarget(target, children.map((child) => child.getTextContent()));
    // Like append(), trailing empty lines do not count.
    let end = children.length;
    while (end > 0 && !children[end - 1].getTextContent().trim()) end--;
    keys = keys.slice(0, Math.max(end, 1));
  });
  const at = resolved as ProposalTarget | null;
  if (!at) return;
  const state: PreviewState = { marked: [], spaced: null, ghost: null };
  if (at.mode === "replace") {
    for (let i = at.from; i <= at.to; i++) {
      const el = editor.getElementByKey(keys[i] ?? "");
      if (!el) continue;
      el.setAttribute("data-ag-preview", "replace");
      state.marked.push(el);
    }
  }
  const anchorKey = at.mode === "replace" ? keys[at.to] : at.mode === "insertAfter" ? keys[at.block] : keys[keys.length - 1];
  const anchor = anchorKey ? editor.getElementByKey(anchorKey) : null;
  if (!anchor) {
    preview = state;
    return;
  }
  const ghost = document.createElement("div");
  ghost.className = "ag-ghost";
  ghost.setAttribute("aria-hidden", "true");
  for (const block of blocks) {
    const line = document.createElement("div");
    line.className = `gb gb-${block.type}`;
    line.textContent = block.text;
    ghost.appendChild(line);
  }
  const label = document.createElement("span");
  label.className = "ag-ghost-tag";
  label.textContent = tag;
  ghost.appendChild(label);
  const sheetRect = sheet.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  ghost.style.left = `${rootRect.left - sheetRect.left - 14}px`;
  ghost.style.width = `${rootRect.width + 28}px`;
  sheet.appendChild(ghost);
  // Make room below the anchor line, then sit the ghost in that gap.
  anchor.style.setProperty("--ag-ghost-space", `${ghost.offsetHeight + 20}px`);
  anchor.setAttribute("data-ag-ghost-after", "");
  ghost.style.top = `${anchor.getBoundingClientRect().bottom - sheetRect.top + 10}px`;
  state.spaced = anchor;
  state.ghost = ghost;
  preview = state;
}
