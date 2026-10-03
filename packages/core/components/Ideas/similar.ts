// "Similar" links of the open idea row and the capture field: finds scripts
// and other ideas that look like the idea, so nothing gets written twice.
//
// Scripts come from the full-text search. Both adapters combine query
// words with AND, so searching the whole title would rarely hit anything;
// instead the most distinctive title words are searched one by one and the
// hit lists are merged by reciprocal rank. Ideas are compared in memory via
// Jaccard similarity of their title word sets.

import { jaccardSimilarity, wordTokenSet } from "../../lib/lex";
import type { Idea, SearchHit } from "../../lib/types";

// Frequent German/English filler words (>= 3 chars; shorter tokens are
// already dropped by wordTokenSet). Not exhaustive - just enough that a
// title like "Timo geht um 13 Uhr" searches for "timo"/"geht", not "uhr".
const STOPWORDS = new Set([
  "aber", "alle", "allem", "als", "also", "auch", "auf", "aus", "bei", "beim", "bis",
  "das", "dass", "dem", "den", "der", "des", "die", "dies", "diese", "doch", "ein",
  "eine", "einem", "einen", "einer", "eines", "für", "gibt", "hat", "hätte", "ich",
  "ihr", "ist", "jetzt", "kein", "keine", "mal", "man", "mehr", "mit", "nach", "nicht",
  "noch", "nur", "oder", "ohne", "sein", "sich", "sie", "sind", "statt", "über", "uhr",
  "und", "uns", "unter", "vom", "von", "vor", "wann", "warum", "was", "weil", "wenn",
  "wer", "wie", "wieder", "wir", "wird", "zum", "zur",
  "and", "are", "but", "for", "from", "has", "have", "into", "not", "the", "that",
  "then", "this", "was", "what", "when", "who", "why", "with", "you", "your",
]);

/** Up to `max` search terms from a title: stopwords removed, longest
 *  (most distinctive) words first, ties in title order. */
export function similarQueryTerms(title: string, max = 3): string[] {
  const words = [...wordTokenSet(title)].filter((w) => !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return words
    .map((w, i) => ({ w, i }))
    .sort((a, b) => b.w.length - a.w.length || a.i - b.i)
    .slice(0, max)
    .map((x) => x.w);
}

export interface RankedHit {
  id: string;
  title: string;
  score: number;
}

/** Merges several ranked hit lists (one per search term) by reciprocal
 *  rank: a script that shows up high for several words wins. */
export function rankScriptHits(lists: SearchHit[][], excludeIds: Set<string> = new Set()): RankedHit[] {
  const acc = new Map<string, RankedHit>();
  for (const list of lists) {
    list.forEach((hit, rank) => {
      if (excludeIds.has(hit.id)) return;
      const prev = acc.get(hit.id);
      const add = 1 / (rank + 1);
      if (prev) prev.score += add;
      else acc.set(hit.id, { id: hit.id, title: hit.title, score: add });
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

/** Other ideas whose title (plus notes, weighted lower) resembles the
 *  target's title. */
export function similarIdeas(
  target: Pick<Idea, "id" | "title">,
  all: Pick<Idea, "id" | "title" | "used_at">[],
  max = 2,
  threshold = 0.2,
): Array<{ id: string; title: string; used: boolean; score: number }> {
  const base = new Set([...wordTokenSet(target.title)].filter((w) => !STOPWORDS.has(w)));
  if (base.size === 0) return [];
  const out: Array<{ id: string; title: string; used: boolean; score: number }> = [];
  for (const other of all) {
    if (other.id === target.id) continue;
    const set = new Set([...wordTokenSet(other.title)].filter((w) => !STOPWORDS.has(w)));
    if (set.size === 0) continue;
    const score = jaccardSimilarity(base, set);
    if (score >= threshold) out.push({ id: other.id, title: other.title, used: !!other.used_at, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}
