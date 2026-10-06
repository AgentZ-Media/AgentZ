// Script <-> agent text. The model sees a script as numbered lines, one per
// block, so it can point at exact blocks ("replace 12-14") without ever
// touching Lexical JSON. Proposals come back as typed block lists.

import { extractBlocks } from "../lex";

export type AgentBlockType = "action" | "character" | "dialog" | "parenthetical";
export const AGENT_BLOCK_TYPES: readonly AgentBlockType[] = ["action", "character", "dialog", "parenthetical"];

export interface AgentBlock {
  type: AgentBlockType;
  text: string;
}

const KIND_TO_TYPE: Record<string, AgentBlockType> = {
  "scriptz-action": "action",
  "scriptz-character": "character",
  "scriptz-dialog": "dialog",
  "scriptz-parenthetical": "parenthetical",
  action: "action",
  character: "character",
  dialog: "dialog",
  paren: "parenthetical",
};

export function blockTypeOf(kind: string): AgentBlockType {
  return KIND_TO_TYPE[kind] ?? "action";
}

export function blocksFromContent(contentJson: string): AgentBlock[] {
  return extractBlocks(contentJson).map((block) => ({ type: blockTypeOf(block.kind), text: block.text }));
}

/** `[3] DIALOG (TIMO): text` - the speaker is repeated on dialog and
 *  parenthetical lines so a single line is self-explanatory. */
export function numberedScript(blocks: readonly AgentBlock[]): string {
  let speaker = "";
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    const text = block.text.replace(/\n/g, " / ");
    if (block.type === "character") speaker = text.trim().toUpperCase();
    else if (block.type === "action") speaker = "";
    const label = block.type.toUpperCase();
    const who = (block.type === "dialog" || block.type === "parenthetical") && speaker ? ` (${speaker})` : "";
    lines.push(`[${index}] ${label}${who}: ${text}`);
  });
  return lines.join("\n");
}

export function charactersIn(blocks: readonly AgentBlock[]): string[] {
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== "character") continue;
    const name = block.text.trim().toUpperCase();
    if (name) seen.add(name);
  }
  return [...seen];
}

/** One line per block, `type:text`: what learning hashes and stores
 *  (`agent_learned.learned_text`) to compare later versions against. */
export function learnText(blocks: readonly AgentBlock[]): string {
  return blocks.map((b) => `${b.type}:${b.text}`).join("\n");
}

/** Cheap stable hash of a script's text (learning dedupe). */
export function hashBlocks(blocks: readonly AgentBlock[]): string {
  const text = learnText(blocks);
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (h2 * 31 + c) | 0;
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${text.length}`;
}
