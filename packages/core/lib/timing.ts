// Per-block timeline (speaker tracks) for the length goal feature.
//
// Same formula as lib/runtime.ts, applied per block instead of as a sum:
//  - Dialog block:    words / WPM * 60 seconds
//  - Action block:    SECONDS_PER_DIRECTION_BLOCK (2 s), also when empty -
//                     runtime.ts counts every action block
//  - Character block: 0 s, only sets the current speaker
//  - Parenthetical:   0 s, no segment - a delivery cue belongs to the
//                     current speaker's speech run but is not spoken
//                     (runtime.ts counts it neither as dialog nor as
//                     action), so it neither moves the clock nor resets
//                     the speaker
//
// Invariant: the sum of all `durSec` equals the unrounded runtime, so
//   runtimeSeconds(stats, wpm) === Math.max(MIN_RUNTIME_SEC, Math.round(sum))
// for the same content. The 5 s minimum (MIN_RUNTIME_SEC) applies to the
// displayed TOTAL only; segments are never scaled up to fill it. A timeline
// UI should therefore use the total from runtime.ts for labels and its axis
// window, and simply draw the (possibly shorter) segments.
//
// Speaker attribution follows lex.ts::dialogWordsByCharacter (the source of
// the cast shares): a dialog belongs to the most recent character block
// above it, also across action and parenthetical blocks in between. Action
// segments carry `speaker: null`.

import { extractBlocks } from "./lex";
import { SECONDS_PER_DIRECTION_BLOCK, wordCount } from "./runtime";

export type TimingBlock = {
  /** Lexical node key (editor callers) - passed through to the segment so
   *  hover/click can map back to the block. */
  key?: string;
  kind: "action" | "character" | "dialog" | "paren";
  text: string;
};

export type TimelineSegment = {
  key?: string;
  kind: "action" | "dialog";
  /** Uppercased, trimmed character name; null for action segments and for
   *  dialog without any character block above it. */
  speaker: string | null;
  startSec: number;
  durSec: number;
  text: string;
};

/** Computes start + duration for every timed block. Character and
 *  parenthetical blocks yield no segment; dialog blocks without words yield
 *  no segment either (they have zero duration and contribute nothing to the
 *  runtime). Times are unrounded seconds. */
export function computeTimeline(
  blocks: TimingBlock[],
  wpm: number,
): TimelineSegment[] {
  const safeWpm = Math.max(1, wpm);
  const out: TimelineSegment[] = [];
  let cursor = 0;
  let speaker: string | null = null;
  for (const b of blocks) {
    if (b.kind === "character") {
      const name = b.text.trim().toUpperCase();
      speaker = name.length > 0 ? name : null;
      continue;
    }
    if (b.kind === "paren") continue;
    if (b.kind === "action") {
      out.push({
        key: b.key,
        kind: "action",
        speaker: null,
        startSec: cursor,
        durSec: SECONDS_PER_DIRECTION_BLOCK,
        text: b.text,
      });
      cursor += SECONDS_PER_DIRECTION_BLOCK;
      continue;
    }
    const words = wordCount(b.text);
    if (words === 0) continue;
    const dur = (words / safeWpm) * 60;
    out.push({
      key: b.key,
      kind: "dialog",
      speaker,
      startSec: cursor,
      durSec: dur,
      text: b.text,
    });
    cursor += dur;
  }
  return out;
}

/** Builds timing blocks from a serialized Lexical state (non-editor
 *  callers: lists, exports, tests). Retired block types (camera, caption,
 *  sfx) arrive as action via lex.ts. Blocks carry no `key`. */
export function timingBlocksFromContentJson(json: string): TimingBlock[] {
  const out: TimingBlock[] = [];
  for (const b of extractBlocks(json)) {
    if (b.kind === "scriptz-action") out.push({ kind: "action", text: b.text });
    else if (b.kind === "scriptz-character") out.push({ kind: "character", text: b.text });
    else if (b.kind === "scriptz-dialog") out.push({ kind: "dialog", text: b.text });
    else if (b.kind === "scriptz-parenthetical") out.push({ kind: "paren", text: b.text });
  }
  return out;
}
