// Predict who should speak next, used by the character-autocomplete
// dropdown to pre-highlight the most likely next character so Enter
// accepts it. Independent of Quick mode (Quick mode is strictly the
// 2-character deterministic auto-insert).
//
// Heuristic: bigram counts (how often Y has followed prev historically
// in this script) drive the score; LRU is the tiebreaker so equally-
// frequent candidates rotate naturally instead of always resolving to
// the same name.

import { $getRoot, type LexicalNode } from "lexical";
import {
  $isScriptzCharacterNode,
  type BaseScriptzNode,
  type ScriptzCharacterNode,
} from "./nodes";
import type { ScriptCharacter } from "../../lib/types";

/** Walk back from any block to find the most recent Character block above
 * it (skipping its own siblings). Returns the upper-cased trimmed name. */
export function previousCharacterFrom(
  block: BaseScriptzNode,
): string | null {
  let prev: LexicalNode | null = block.getPreviousSibling();
  while (prev) {
    if ($isScriptzCharacterNode(prev)) {
      const node = prev as ScriptzCharacterNode;
      const name = node.getTextContent().trim().toUpperCase();
      return name || null;
    }
    prev = prev.getPreviousSibling();
  }
  return null;
}

/** Walk the document and collect the ordered sequence of speakers. Empty
 * Character blocks are skipped — they don't contribute to the prediction. */
export function collectSpeakerSequence(): string[] {
  const out: string[] = [];
  for (const child of $getRoot().getChildren()) {
    if ($isScriptzCharacterNode(child)) {
      const name = (child as ScriptzCharacterNode)
        .getTextContent()
        .trim()
        .toUpperCase();
      if (name) out.push(name);
    }
  }
  return out;
}

/** Rank all candidates by "who is most likely to speak next given the
 * previous speaker". Used both for the highlight (top entry) and for
 * sorting the autocomplete dropdown so the visual order matches the
 * prediction — second-most-likely is row 2, etc.
 *
 *   1. Drop the previous speaker from the head of the ranking (avoids
 *      the dropdown suggesting "A → A" right after A spoke). They
 *      rejoin at the tail so the user can still pick them if they
 *      really want.
 *   2. Within the remaining candidates: bigram score (how often Y has
 *      historically followed `prev`) descending, LRU (least recently
 *      spoken) ascending as a tiebreaker. Never-spoken characters get
 *      LRU = -1 so they rotate in before any previously-used one when
 *      bigram scores tie.
 */
export function rankNextSpeakers(
  prev: string | null,
  candidates: ScriptCharacter[],
): ScriptCharacter[] {
  if (candidates.length === 0) return [];
  const prevUpper = (prev ?? "").toUpperCase();
  const sequence = collectSpeakerSequence();

  const bigram = new Map<string, number>();
  if (prevUpper) {
    for (let i = 1; i < sequence.length; i++) {
      if (sequence[i - 1] === prevUpper && sequence[i] !== prevUpper) {
        bigram.set(sequence[i], (bigram.get(sequence[i]) ?? 0) + 1);
      }
    }
  }

  const lru = new Map<string, number>();
  for (let i = 0; i < sequence.length; i++) lru.set(sequence[i], i);

  const others = candidates.filter((c) => c.name.toUpperCase() !== prevUpper);
  const self = candidates.filter((c) => c.name.toUpperCase() === prevUpper);

  others.sort((a, b) => {
    const ua = a.name.toUpperCase();
    const ub = b.name.toUpperCase();
    const bgA = bigram.get(ua) ?? 0;
    const bgB = bigram.get(ub) ?? 0;
    if (bgA !== bgB) return bgB - bgA;
    const lruA = lru.get(ua) ?? -1;
    const lruB = lru.get(ub) ?? -1;
    if (lruA !== lruB) return lruA - lruB;
    return ua.localeCompare(ub);
  });

  return [...others, ...self];
}

/** Pick the single most plausible next speaker. Convenience wrapper —
 * shares the ranking logic, just returns the head (or null if the only
 * remaining candidate is the previous speaker). */
export function predictNextSpeaker(
  prev: string | null,
  candidates: ScriptCharacter[],
): ScriptCharacter | null {
  if (candidates.length === 0) return null;
  const prevUpper = (prev ?? "").toUpperCase();
  const ranked = rankNextSpeakers(prev, candidates);
  // Skip past the previous speaker (rankNextSpeakers keeps them at the
  // tail) — the predicted "next" must not be the one who just spoke.
  const head = ranked.find((c) => c.name.toUpperCase() !== prevUpper);
  return head ?? null;
}
