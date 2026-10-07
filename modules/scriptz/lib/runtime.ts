// Runtime estimate - one source for every display of a script's runtime.
//
// Only dialog words count against the WPM, plus 2 s per action block with
// text; dividing the TOTAL word count (incl. character names,
// parentheticals) would systematically overestimate the runtime. This file
// defines the formula once, scripts.ts persists the two input values on
// save, and every display (editor, library, export, agent) calls
// `runtimeSeconds` with the WPM from the settings.
//
// WPM stays a live setting - it is NOT persisted, so a setting change takes
// effect everywhere immediately without re-saving every script.

import { extractBlocks, wordCount, type ExtractedBlock } from "./lex";

/** Input values of the runtime formula. Stored on save in the
 *  `dialog_word_count` and `direction_block_count` columns. */
export interface RuntimeStats {
  /** Words in dialog blocks. Only these are computed against dialog WPM. */
  dialogWords: number;
  /** Action blocks with text. Each one contributes a short beat; an empty
   *  action block (e.g. the caret line at the end) contributes nothing.
   *  Retired camera / caption / sfx blocks count as action (lex.ts
   *  normalizes them before extraction). Character and parenthetical
   *  blocks contribute nothing: a delivery cue like "(leise)" is not
   *  spoken and takes no extra beat. */
  directionBlocks: number;
}

/** Sentinel "never measured" - identical pattern to `last_word_count`.
 *  Migration 005 sets existing scripts to this value; the backfill
 *  on app start (or at latest the next save) normalizes them. */
export const RUNTIME_STATS_SENTINEL = -1;

/** Seconds each action block contributes. Shared with lib/timing.ts. */
export const SECONDS_PER_DIRECTION_BLOCK = 2;
/** Floor of the displayed total runtime. Applies to the total only -
 *  per-block timeline segments (lib/timing.ts) are never scaled up. */
export const MIN_RUNTIME_SEC = 5;

function isDialogBlock(b: ExtractedBlock): boolean {
  return b.kind === "scriptz-dialog";
}

/** Whether an action block's text makes it a beat. Shared by every
 *  caller that counts action blocks (timeline, inspector, drafts). */
export function isActionBeat(text: string): boolean {
  return text.trim().length > 0;
}

function isDirectionBlock(b: ExtractedBlock): boolean {
  return b.kind === "scriptz-action" && isActionBeat(b.text);
}

export function runtimeStatsFromBlocks(blocks: ExtractedBlock[]): RuntimeStats {
  let dialogWords = 0;
  let directionBlocks = 0;
  for (const b of blocks) {
    if (isDialogBlock(b)) dialogWords += wordCount(b.text);
    else if (isDirectionBlock(b)) directionBlocks += 1;
  }
  return { dialogWords, directionBlocks };
}

export function runtimeStatsFromContent(contentJson: string): RuntimeStats {
  return runtimeStatsFromBlocks(extractBlocks(contentJson));
}

/** Default 210 WPM is calibrated for TikTok / sketch pace (classic
 *  screenplays use 150 WPM). The action beat is 2s because
 *  TikTok stage directions are shorter than classic ones. */
export function runtimeSeconds(stats: RuntimeStats, wpm: number): number {
  const dialog = Math.max(0, stats.dialogWords);
  const dir = Math.max(0, stats.directionBlocks);
  const safeWpm = Math.max(1, wpm);
  const sec = (dialog / safeWpm) * 60 + dir * SECONDS_PER_DIRECTION_BLOCK;
  return Math.max(MIN_RUNTIME_SEC, Math.round(sec));
}

/** Runtime from the stored inputs of a script (library, agent tools), or
 *  null when the script was never measured or is empty. */
export function storedRuntimeSeconds(
  s: { dialog_word_count: number; direction_block_count: number },
  wpm: number,
): number | null {
  if (s.dialog_word_count < 0 || s.direction_block_count < 0) return null;
  if (s.dialog_word_count === 0 && s.direction_block_count === 0) return null;
  return runtimeSeconds({ dialogWords: s.dialog_word_count, directionBlocks: s.direction_block_count }, wpm);
}
