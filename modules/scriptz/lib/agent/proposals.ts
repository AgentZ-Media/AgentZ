// Structured results the agent hands to the UI through tools: script
// proposals (1-3 options, rendered like the paper and inserted on click)
// and fact checks. Tool arguments come from a model, so every parser here
// is defensive and drops what it cannot use instead of throwing.

import { AGENT_BLOCK_TYPES, type AgentBlock, type AgentBlockType } from "./scriptText";

/** Where a proposal goes. `anchor` holds the text of the targeted blocks at
 *  proposal time; applying checks it so edits made since then never cause
 *  the wrong lines to be replaced. */
export type ProposalTarget =
  | { mode: "append" }
  | { mode: "insertAfter"; block: number; anchor?: string[] }
  | { mode: "replace"; from: number; to: number; anchor?: string[] };

export interface ProposalOption {
  title: string;
  note: string;
  blocks: AgentBlock[];
  /** "Einstieg prüfen": index (within `blocks`) of the block where the
   *  conflict becomes clear in this version. */
  conflictBlock?: number;
}

export interface Proposal {
  target: ProposalTarget;
  options: ProposalOption[];
  /** "Einstieg prüfen": script index of the block where the conflict
   *  becomes clear today (for "Konflikt nach 1,1 s statt 4,6 s"). */
  currentConflict?: number;
}

export type ClaimVerdict = "correct" | "imprecise" | "wrong" | "unclear";
export const CLAIM_VERDICTS: readonly ClaimVerdict[] = ["correct", "imprecise", "wrong", "unclear"];

export interface ClaimSource {
  title: string;
  url: string;
}

export interface Claim {
  quote: string;
  verdict: ClaimVerdict;
  explanation: string;
  sources: ClaimSource[];
  /** Optional corrected wording, applied like a proposal option. */
  fix: { target: ProposalTarget; blocks: AgentBlock[] } | null;
}

const MAX_OPTIONS = 3;
const MAX_BLOCKS = 60;
const MAX_TEXT = 2000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = MAX_TEXT): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parseBlocks(raw: unknown): AgentBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: AgentBlock[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS)) {
    if (!isObj(item)) continue;
    const type = str(item.type, 20).toLowerCase() as AgentBlockType;
    if (!(AGENT_BLOCK_TYPES as readonly string[]).includes(type)) continue;
    let text = str(item.text);
    if (type === "character") text = text.toUpperCase();
    if (type === "parenthetical" && text && !text.startsWith("(")) text = `(${text.replace(/^\(|\)$/g, "")})`;
    if (!text) continue;
    out.push({ type, text });
  }
  return out;
}

/** Null when the indices point past the script the model saw: that is a
 *  stale or wrong reference, and guessing the last block would replace the
 *  wrong lines. The model is asked to re-read instead. */
export function parseTarget(raw: unknown, blockCount: number): ProposalTarget | null {
  // Nothing to replace or insert after in an empty script.
  if (!isObj(raw) || blockCount === 0) return { mode: "append" };
  const mode = str(raw.mode, 20);
  const inRange = (n: number) => n < blockCount;
  if (mode === "replace") {
    const from = int(raw.from);
    const to = int(raw.to) ?? from;
    if (from !== null && to !== null) {
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      return inRange(b) ? { mode: "replace", from: a, to: b } : null;
    }
  }
  if (mode === "insert_after" || mode === "insertAfter") {
    const block = int(raw.block);
    if (block !== null) return inRange(block) ? { mode: "insertAfter", block } : null;
  }
  return { mode: "append" };
}

/** Records the current text of the blocks a target points at. */
export function anchorTarget(target: ProposalTarget, texts: readonly string[]): ProposalTarget {
  if (target.mode === "replace") return { ...target, anchor: texts.slice(target.from, target.to + 1) };
  if (target.mode === "insertAfter") return { ...target, anchor: texts.slice(target.block, target.block + 1) };
  return target;
}

/** Maps a target onto the script as it is now. Unchanged position: as is.
 *  Anchored text moved (lines added or removed above): follows it if it
 *  occurs exactly once. Otherwise null, the user has to ask again. */
export function resolveTarget(target: ProposalTarget, texts: readonly string[]): ProposalTarget | null {
  if (target.mode === "append") return target;
  const from = target.mode === "replace" ? target.from : target.block;
  const to = target.mode === "replace" ? target.to : target.block;
  const anchor = target.anchor;
  // Chats saved before anchors existed: index check only.
  if (!anchor || anchor.length === 0) return to < texts.length ? target : null;
  const matchesAt = (start: number) => start + anchor.length <= texts.length && anchor.every((text, k) => texts[start + k] === text);
  let start = from;
  if (!matchesAt(from)) {
    const hits: number[] = [];
    for (let i = 0; i + anchor.length <= texts.length && hits.length < 2; i++) if (matchesAt(i)) hits.push(i);
    if (hits.length !== 1) return null;
    start = hits[0];
  }
  return target.mode === "replace"
    ? { ...target, from: start, to: start + (to - from) }
    : { ...target, block: start };
}

export function parseProposal(raw: unknown, blockCount: number): Proposal | null {
  if (!isObj(raw)) return null;
  const options: ProposalOption[] = [];
  if (Array.isArray(raw.options)) {
    for (const item of raw.options.slice(0, MAX_OPTIONS)) {
      if (!isObj(item)) continue;
      const blocks = parseBlocks(item.blocks);
      if (blocks.length === 0) continue;
      const option: ProposalOption = { title: str(item.title, 80), note: str(item.note, 240), blocks };
      const conflict = int(item.conflict_block);
      if (conflict !== null && conflict < blocks.length) option.conflictBlock = conflict;
      options.push(option);
    }
  }
  const target = parseTarget(raw.target, blockCount);
  if (options.length === 0 || !target) return null;
  const proposal: Proposal = { target, options };
  const current = int(raw.current_conflict_block);
  if (current !== null && current < blockCount) proposal.currentConflict = current;
  return proposal;
}

function parseUrl(raw: unknown): string {
  const url = str(raw, 600);
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function parseClaims(raw: unknown, blockCount: number): Claim[] {
  if (!isObj(raw) || !Array.isArray(raw.claims)) return [];
  const out: Claim[] = [];
  for (const item of raw.claims.slice(0, 12)) {
    if (!isObj(item)) continue;
    const quote = str(item.quote, 400);
    if (!quote) continue;
    const verdict = (CLAIM_VERDICTS as readonly string[]).includes(str(item.verdict, 20))
      ? (str(item.verdict, 20) as ClaimVerdict)
      : "unclear";
    const sources: ClaimSource[] = [];
    if (Array.isArray(item.sources)) {
      for (const source of item.sources.slice(0, 5)) {
        if (!isObj(source)) continue;
        const url = parseUrl(source.url);
        if (url) sources.push({ url, title: str(source.title, 120) || new URL(url).hostname });
      }
    }
    let fix: Claim["fix"] = null;
    if (isObj(item.fix)) {
      const blocks = parseBlocks(item.fix.blocks);
      const target = parseTarget(item.fix.target, blockCount);
      if (blocks.length > 0 && target) fix = { target, blocks };
    }
    out.push({ quote, verdict, explanation: str(item.explanation, 600), sources, fix });
  }
  return out;
}

/** Host name without "www." for compact source chips. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
