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
import {
  BaseScriptzNode,
  $createScriptzActionNode,
  $createScriptzCharacterNode,
  $createScriptzDialogNode,
  $createScriptzParentheticalNode,
} from "../Editor/nodes";
import { blockTypeOf, type AgentBlock, type AgentBlockType } from "../../lib/agent/scriptText";
import { resolveTarget, type ProposalTarget } from "../../lib/agent/proposals";

const FACTORY: Record<AgentBlockType, () => BaseScriptzNode> = {
  action: $createScriptzActionNode,
  character: $createScriptzCharacterNode,
  dialog: $createScriptzDialogNode,
  parenthetical: $createScriptzParentheticalNode,
};

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
  const node = FACTORY[block.type]();
  // Empty blocks stay childless (WebKit caret invariant, see CLAUDE.md).
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
  editor.update(() => {
    const root = $getRoot();
    const children = root.getChildren();
    const target = resolveTarget(proposed, children.map((child) => child.getTextContent()));
    if (!target) return;
    const nodes = blocks.map(buildNode);
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
    // Append: reuse a trailing empty block instead of leaving a gap.
    const last = root.getLastChild();
    if (last && !last.getTextContent().trim()) last.remove();
    for (const node of nodes) root.append(node);
    nodes[nodes.length - 1].selectEnd();
    applied = target;
  });
  // Hand the keyboard back to the paper so ⌘Z undoes the insert right away.
  if (applied && editor.getRootElement()) editor.focus();
  return applied;
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
