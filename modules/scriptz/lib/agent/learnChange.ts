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

/** Splits a `learnText` string back into blocks. A block's text may hold
 *  line breaks: a line without a `type:` prefix continues the block above. */
function parseLines(text: string): Line[] {
  if (!text) return [];
  const lines: Line[] = [];
  for (const raw of text.split("\n")) {
    const colon = raw.indexOf(":");
    const type = raw.slice(0, colon) as AgentBlockType;
    if (AGENT_BLOCK_TYPES.includes(type)) lines.push({ type, text: raw.slice(colon + 1) });
    else if (lines.length) lines[lines.length - 1].text += `\n${raw}`;
    else lines.push({ type: "action", text: raw });
  }
  return lines;
}

/** The speaker of each line: the most recent character above it, like the
 *  cast shares in lib/lex.ts (empty before the first character). */
function speakers(lines: readonly Line[]): string[] {
  let speaker = "";
  return lines.map((line) => {
    if (line.type === "character") speaker = line.text.trim().replace(/\s+/g, " ").toUpperCase();
    return line.type === "dialog" || line.type === "parenthetical" ? speaker : "";
  });
}

/** Word counts per speaker and lower-cased word (UAX #29 word segments), so
 *  lines moved to another character count as changed. */
function countWords(lines: readonly Line[]): Map<string, number> {
  const seg = new Intl.Segmenter(undefined, { granularity: "word" });
  const who = speakers(lines);
  const counts = new Map<string, number>();
  lines.forEach((line, i) => {
    for (const piece of seg.segment(line.text.toLowerCase())) {
      if (!piece.isWordLike) continue;
      const key = `${who[i]}\u0000${piece.segment}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  });
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

  // Lines of the new version that the old one did not have (as a multiset,
  // per speaker).
  const oldSpeakers = speakers(old);
  const remaining = new Map<string, number>();
  old.forEach((line, i) => {
    const key = `${line.type}:${oldSpeakers[i]}:${line.text}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  });
  const nextSpeakers = speakers(next);
  const changedLines: string[] = [];
  for (const [i, line] of next.entries()) {
    const text = line.text.replace(/\s+/g, " ").trim();
    const speaker = nextSpeakers[i];
    const key = `${line.type}:${speaker}:${line.text}`;
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
