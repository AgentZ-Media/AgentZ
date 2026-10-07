// Drafts of the agent mode. The agent writes a script draft as a fenced
// block inside its normal reply, so the text streams in token by token:
//
//   :::draft id="mausbewegung" title="Die Mausbewegung" idea="<idea id>"
//   ACTION: Homeoffice. Timo liegt auf dem Sofa.
//   AXEL: Timo. Deine Maus hat sich seit 11:42 nicht bewegt.
//   TIMO (leise): Ich denke nach.
//   :::
//
// The same id again is a new version of that draft. Drafts are derived from
// the chat items (nothing else is stored), so a reload, a crash mid-stream
// or a chat moved into a script all show the same drafts. A draft only
// becomes a real script through the finish dialog.

import { wordCount } from "../lex";
import { isActionBeat, runtimeSeconds } from "../runtime";
import type { AgentBlock } from "./scriptText";

export interface DraftAttrs {
  /** Stable draft key chosen by the model (same id = new version). */
  slug: string;
  title: string;
  ideaId: string | null;
}

export type DraftSegment =
  | { kind: "text"; text: string }
  | { kind: "draft"; attrs: DraftAttrs; body: string; complete: boolean };

const OPEN = /^[ \t]*:::draft\b([^\n]*)$/m;
const CLOSE = /^[ \t]*:::[ \t]*$/m;
const ATTR = /([a-zA-Z_]+)\s*=\s*"([^"]*)"/g;

export const MAX_DRAFT_TITLE = 120;

/** Lowercase ascii slug for draft ids; never empty. */
export function draftSlug(raw: string): string {
  const base = raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "draft";
}

function parseAttrs(raw: string): DraftAttrs {
  const values: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR)) values[match[1].toLowerCase()] = match[2].trim();
  const title = (values.title ?? "").slice(0, MAX_DRAFT_TITLE);
  const slug = draftSlug(values.id || title);
  const idea = values.idea ?? "";
  return { slug, title, ideaId: /^[0-9a-f-]{8,64}$/i.test(idea) ? idea : null };
}

/** Splits an assistant message into chat text and draft blocks. A draft
 *  without its closing fence is still streaming (`complete: false`). */
export function splitDraftSegments(text: string): DraftSegment[] {
  const out: DraftSegment[] = [];
  let rest = text;
  for (;;) {
    const open = OPEN.exec(rest);
    if (!open) break;
    const before = rest.slice(0, open.index);
    if (before.trim()) out.push({ kind: "text", text: before });
    const afterOpen = rest.slice(open.index + open[0].length).replace(/^\r?\n/, "");
    const close = CLOSE.exec(afterOpen);
    const attrs = parseAttrs(open[1]);
    if (!close) {
      out.push({ kind: "draft", attrs, body: afterOpen, complete: false });
      return out;
    }
    out.push({ kind: "draft", attrs, body: afterOpen.slice(0, close.index), complete: true });
    rest = afterOpen.slice(close.index + close[0].length);
  }
  if (rest.trim()) out.push({ kind: "text", text: rest });
  return out;
}

export function hasDraft(text: string): boolean {
  return OPEN.test(text);
}

/** Text of a message without its draft blocks (for previews, copies). */
export function textWithoutDrafts(text: string): string {
  return splitDraftSegments(text)
    .filter((s): s is Extract<DraftSegment, { kind: "text" }> => s.kind === "text")
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

const SPEAKER = /^([^:()\n]{1,40}?)\s*(?:\(([^)\n]{1,80})\))?\s*:\s*(.*)$/;
const ACTION_TAGS = new Set(["ACTION", "AKTION", "REGIE"]);

function isSpeakerName(name: string): boolean {
  return /\p{L}/u.test(name) && name === name.toUpperCase();
}

/** Lines of a draft body as script blocks. Unknown lines become action, so
 *  nothing the model writes is lost. While streaming, the last (partial)
 *  line is included as it is. */
export function parseDraftBody(body: string, streaming = false): AgentBlock[] {
  const blocks: AgentBlock[] = [];
  const lines = body.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    // The line being written: a speaker name before its colon is already
    // shown as the speaker, not as an action line that flips over.
    if (streaming && index === lines.length - 1 && !line.includes(":")) {
      const partial = /^([^:()]{1,40}?)\s*(?:\(([^)]*)\)?)?$/.exec(line);
      const name = partial?.[1].trim() ?? "";
      if (partial && name && isSpeakerName(name) && !ACTION_TAGS.has(name.toUpperCase())) {
        blocks.push({ type: "character", text: name.toUpperCase() });
        if (partial[2]?.trim()) blocks.push({ type: "parenthetical", text: `(${partial[2].trim()}` });
        return;
      }
    }
    const cue = /^\(([^)]{1,80})\)$/.exec(line);
    if (cue) {
      blocks.push({ type: "parenthetical", text: `(${cue[1].trim()})` });
      return;
    }
    const match = SPEAKER.exec(line);
    if (match) {
      const name = match[1].trim();
      const upper = name.toUpperCase();
      if (ACTION_TAGS.has(upper)) {
        if (match[3].trim()) blocks.push({ type: "action", text: match[3].trim() });
        return;
      }
      if (isSpeakerName(name)) {
        blocks.push({ type: "character", text: upper });
        if (match[2]?.trim()) blocks.push({ type: "parenthetical", text: `(${match[2].trim()})` });
        if (match[3].trim()) blocks.push({ type: "dialog", text: match[3].trim() });
        return;
      }
    }
    blocks.push({ type: "action", text: line });
  });
  return blocks;
}

/** A draft block as the agent would write it (also used to show a version
 *  to the model again). */
export function draftBodyFromBlocks(blocks: readonly AgentBlock[]): string {
  const lines: string[] = [];
  let speaker = "";
  let cue = "";
  for (const block of blocks) {
    if (block.type === "character") {
      speaker = block.text.trim().toUpperCase();
      cue = "";
    } else if (block.type === "parenthetical") {
      cue = block.text.trim().replace(/^\(|\)$/g, "");
    } else if (block.type === "dialog") {
      lines.push(`${speaker || "?"}${cue ? ` (${cue})` : ""}: ${block.text.trim()}`);
      cue = "";
    } else {
      speaker = "";
      lines.push(`ACTION: ${block.text.trim()}`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- versions

export interface DraftVersion {
  /** `${itemId}#${index}`: the message and the n-th draft in it. */
  id: string;
  itemId: string;
  title: string;
  ideaId: string | null;
  blocks: AgentBlock[];
  complete: boolean;
}

export interface DraftThread {
  slug: string;
  versions: DraftVersion[];
}

interface MessageLike {
  kind: string;
  id: string;
  text?: string;
  /** Still streaming; a draft without its closing fence is then unfinished. */
  streaming?: boolean;
}

interface ParsedDraft {
  attrs: DraftAttrs;
  blocks: AgentBlock[];
  complete: boolean;
}

/** Parsed drafts per message id. A message is parsed again only when its
 *  text or streaming state changed, so a streamed token re-parses just the
 *  message being written. The text is compared in full (equal strings from
 *  the store are usually the same reference). */
const parsedMessages = new Map<string, { text: string; streaming: boolean; drafts: ParsedDraft[] }>();
const PARSED_MESSAGES_MAX = 2000;

function draftsOf(id: string, text: string, streaming: boolean): ParsedDraft[] {
  const hit = parsedMessages.get(id);
  if (hit && hit.streaming === streaming && hit.text === text) return hit.drafts;
  const drafts: ParsedDraft[] = [];
  if (hasDraft(text)) {
    for (const segment of splitDraftSegments(text)) {
      if (segment.kind !== "draft") continue;
      drafts.push({
        attrs: segment.attrs,
        blocks: parseDraftBody(segment.body, !segment.complete && streaming),
        // A message that stopped (interrupted, crashed) without the closing
        // fence still leaves a usable draft.
        complete: segment.complete || !streaming,
      });
    }
  }
  parsedMessages.delete(id);
  parsedMessages.set(id, { text, streaming, drafts });
  // Oldest first in insertion order.
  if (parsedMessages.size > PARSED_MESSAGES_MAX) parsedMessages.delete(parsedMessages.keys().next().value as string);
  return drafts;
}

/** All drafts of a chat in order of first appearance, each with its
 *  versions in chat order. */
export function collectDrafts(items: readonly MessageLike[]): DraftThread[] {
  const bySlug = new Map<string, DraftThread>();
  for (const item of items) {
    if (item.kind !== "assistant" || typeof item.text !== "string") continue;
    let n = 0;
    for (const draft of draftsOf(item.id, item.text, item.streaming === true)) {
      const id = `${item.id}#${n++}`;
      let thread = bySlug.get(draft.attrs.slug);
      if (!thread) {
        thread = { slug: draft.attrs.slug, versions: [] };
        bySlug.set(draft.attrs.slug, thread);
      }
      const previous = thread.versions[thread.versions.length - 1];
      thread.versions.push({
        id,
        itemId: item.id,
        // A revision without a title keeps the previous one.
        title: draft.attrs.title || previous?.title || "",
        ideaId: draft.attrs.ideaId ?? previous?.ideaId ?? null,
        blocks: draft.blocks,
        complete: draft.complete,
      });
    }
  }
  return [...bySlug.values()];
}

/** Indices of blocks in `next` that are new or changed compared with
 *  `previous` (longest common subsequence on type + text). */
export function changedBlocks(previous: readonly AgentBlock[], next: readonly AgentBlock[]): Set<number> {
  const key = (b: AgentBlock) => `${b.type}\u0000${b.text.trim()}`;
  const a = previous.map(key);
  const b = next.map(key);
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + j + 1] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const kept = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      kept.add(j);
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++;
    else j++;
  }
  const changed = new Set<number>();
  next.forEach((block, index) => {
    // Speaker lines of a changed line are not news on their own.
    if (!kept.has(index) && block.type !== "character") changed.add(index);
  });
  return changed;
}

// ---------------------------------------------------------------- script

function lexicalBlock(block: AgentBlock) {
  const type = `scriptz-${block.type}`;
  const text = block.type === "character" ? block.text.trim().toUpperCase() : block.text;
  return {
    type,
    version: 1,
    direction: null,
    format: "",
    indent: 0,
    ...(block.type === "character" ? { characterName: text } : {}),
    children: text
      ? [{ detail: 0, format: 0, mode: "normal", style: "", text, type: "text", version: 1 }]
      : [],
  };
}

/** Lexical state for a new script made from a draft. Ends with an empty
 *  action block so the caret has a place after the last line. */
export function contentJsonFromBlocks(blocks: readonly AgentBlock[]): string {
  const children = blocks.filter((b) => b.text.trim()).map(lexicalBlock);
  children.push(lexicalBlock({ type: "action", text: "" }));
  return JSON.stringify({
    root: { type: "root", version: 1, direction: null, format: "", indent: 0, children },
  });
}

/** Words of a draft (dialog + action, like the script word count). */
export function draftWords(blocks: readonly AgentBlock[]): number {
  let n = 0;
  for (const block of blocks) {
    if (block.type !== "character") n += wordCount(block.text);
  }
  return n;
}

/** Runtime of agent blocks (a draft, or a script as the agent tools show
 *  it) with the formula of lib/runtime.ts, so it matches the editor, the
 *  library and the script a draft turns into. 0 for nothing to measure. */
export function draftRuntime(blocks: readonly AgentBlock[], wpm: number): number {
  let dialogWords = 0;
  let directionBlocks = 0;
  for (const block of blocks) {
    if (block.type === "dialog") dialogWords += wordCount(block.text);
    else if (block.type === "action" && isActionBeat(block.text)) directionBlocks += 1;
  }
  if (dialogWords === 0 && directionBlocks === 0) return 0;
  return runtimeSeconds({ dialogWords, directionBlocks }, wpm);
}

/** Plain text of a draft for the clipboard (character name above the line). */
export function draftPlainText(title: string, blocks: readonly AgentBlock[]): string {
  const lines: string[] = title ? [title, ""] : [];
  for (const block of blocks) {
    if (block.type === "character") lines.push("", block.text.trim().toUpperCase());
    else if (block.type === "action") lines.push("", block.text.trim());
    else lines.push(block.text.trim());
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
