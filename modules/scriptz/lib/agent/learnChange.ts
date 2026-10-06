// Whether a script that was already learned changed enough to learn it
// again. Typo fixes and small rewordings do not count; new or rewritten
// passages and new characters do. Both sides are `learnText` strings.

import { AGENT_BLOCK_TYPES, type AgentBlockType } from "./scriptText";

export interface LearnChange {
  /** Words added or removed, whichever is larger (a replaced word counts once). */
  changedWords: number;
  /** Words in the new version. */
  totalWords: number;
  /** Character names that the earlier version did not have. */
  newCharacters: string[];
  /** New or rewritten lines, labelled like the numbered script (capped). */
  changedLines: string[];
}

const MIN_CHANGED_WORDS = 6;
const MAX_CHANGED_WORDS = 25;
const CHANGED_SHARE = 0.1;
const MAX_LINES = 12;
const MAX_LINE_CHARS = 200;

interface Line {
  type: AgentBlockType;
  text: string;
}

function parseLines(text: string): Line[] {
  if (!text) return [];
  return text.split("\n").map((raw) => {
    const colon = raw.indexOf(":");
    const type = raw.slice(0, colon) as AgentBlockType;
    return AGENT_BLOCK_TYPES.includes(type) ? { type, text: raw.slice(colon + 1) } : { type: "action", text: raw };
  });
}

/** Word counts per lower-cased word (UAX #29 word segments). */
function countWords(lines: readonly Line[]): Map<string, number> {
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const piece of seg.segment(line.text.toLowerCase())) {
      if (piece.isWordLike) counts.set(piece.segment, (counts.get(piece.segment) ?? 0) + 1);
    }
  }
  return counts;
}

function characters(lines: readonly Line[]): Set<string> {
  return new Set(lines.filter((l) => l.type === "character").map((l) => l.text.trim().replace(/\s+/g, " ").toUpperCase()).filter(Boolean));
}

/** Compares the learned text with the current one. */
export function learnChange(before: string, after: string): LearnChange {
  const old = parseLines(before);
  const next = parseLines(after);
  const a = countWords(old);
  const b = countWords(next);
  let added = 0;
  let removed = 0;
  let totalWords = 0;
  for (const [word, n] of b) {
    totalWords += n;
    added += Math.max(0, n - (a.get(word) ?? 0));
  }
  for (const [word, n] of a) removed += Math.max(0, n - (b.get(word) ?? 0));

  const known = characters(old);
  const newCharacters = [...characters(next)].filter((name) => !known.has(name));

  // Lines of the new version that the old one did not have (as a multiset).
  const remaining = new Map<string, number>();
  for (const line of old) {
    const key = `${line.type}:${line.text}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const changedLines: string[] = [];
  let speaker = "";
  for (const line of next) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (line.type === "character") speaker = text.toUpperCase();
    else if (line.type === "action") speaker = "";
    const key = `${line.type}:${line.text}`;
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      continue;
    }
    if (line.type === "character" || !text || changedLines.length >= MAX_LINES) continue;
    const who = (line.type === "dialog" || line.type === "parenthetical") && speaker ? ` (${speaker})` : "";
    const shown = text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text;
    changedLines.push(`${line.type.toUpperCase()}${who}: ${shown}`);
  }

  return { changedWords: Math.max(added, removed), totalWords, newCharacters, changedLines };
}

/** Changed words needed before a script is learned again: a tenth of the
 *  script, at least a short sentence and never more than a short passage. */
export function relearnThreshold(totalWords: number): number {
  return Math.min(MAX_CHANGED_WORDS, Math.max(MIN_CHANGED_WORDS, Math.ceil(totalWords * CHANGED_SHARE)));
}

/** True when the change is worth another learning turn. */
export function worthRelearning(change: LearnChange): boolean {
  return change.newCharacters.length > 0 || change.changedWords >= relearnThreshold(change.totalWords);
}
