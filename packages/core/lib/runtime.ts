// Runtime estimate - one source for the editor rail and the browser overview.
//
// Previously there were two places that calculated differently:
// the rail summed only dialog words and added 2s per action block; the overview divided the TOTAL word count (incl. character names,
// parentheticals, captions, SFX) by the same WPM and therefore
// systematically overestimated the runtime. This file defines the formula
// once, scripts.ts persists the two input values on save, and
// both displays call `runtimeSeconds` / `formatRuntime`.
//
// WPM stays a live setting - it is NOT persisted, so a setting change takes
// effect everywhere immediately without re-saving every script.

import { extractBlocks, type ExtractedBlock } from "./lex";
import { t } from "../i18n";

/** Input values of the runtime formula. Stored on save in the
 *  `dialog_word_count` and `direction_block_count` columns. */
export interface RuntimeStats {
  /** Words in dialog blocks. Only these are computed against dialog WPM. */
  dialogWords: number;
  /** Action blocks. Each block contributes a short beat. Retired camera /
   *  caption / sfx / parenthetical blocks count as action since the
   *  block-type reduction (lex.ts normalizes them before extraction). */
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

function isDirectionBlock(b: ExtractedBlock): boolean {
  return b.kind === "scriptz-action";
}

/** Whitespace-separated word count. Shared with lib/timing.ts so the
 *  timeline and the total use the exact same tokenization. */
export function wordCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).filter(Boolean).length;
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

/** "5 s" / "1:23 Min" / "3 Min" - identical format to the rail
 *  since v0.6. */
export function formatRuntime(sec: number): string {
  if (sec < 60) return t("runtime.seconds", { n: sec });
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0
    ? t("runtime.minutes", { m })
    : t("runtime.minutesSeconds", { m, s: String(r).padStart(2, "0") });
}

/** Ready-rendered label from persisted stats. `null` on sentinel
 *  or truly empty script - the caller then omits the field. */
export function runtimeLabelFromStats(stats: RuntimeStats, wpm: number): string | null {
  if (stats.dialogWords < 0 || stats.directionBlocks < 0) return null;
  if (stats.dialogWords === 0 && stats.directionBlocks === 0) return null;
  return formatRuntime(runtimeSeconds(stats, wpm));
}
