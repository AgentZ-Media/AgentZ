// What the agent needs to write to length: the target range of a folder
// (or the global default), the speaking pace and the word budget that
// follows from both. Same formula as the timeline (lib/runtime.ts): dialog
// words at the dialog WPM plus a short beat per action block.

import { formatClock, resolveLengthRange, type LengthRange } from "../lengthGoal";
import { SECONDS_PER_DIRECTION_BLOCK } from "../runtime";
import type { Folder } from "../types";

export interface Pace {
  wpm: number;
  defaults: LengthRange;
}

export interface WritingTarget {
  folderId: string | null;
  folderName: string | null;
  range: LengthRange | null;
  /** Range comes from the folder (true) or the global default (false). */
  fromFolder: boolean;
  wpm: number;
  /** Dialog words that fit the range with a few action beats. */
  dialogWords: { min: number | null; max: number | null } | null;
}

/** Typical number of action blocks in a short sketch; used to turn a
 *  runtime into a dialog word budget. */
export const TYPICAL_ACTION_BEATS = 4;

export function dialogWordsFor(sec: number, wpm: number): number {
  const spoken = Math.max(0, sec - TYPICAL_ACTION_BEATS * SECONDS_PER_DIRECTION_BLOCK);
  return Math.max(0, Math.round((spoken / 60) * Math.max(1, wpm)));
}

export function writingTarget(folder: Folder | null, pace: Pace): WritingTarget {
  const range = resolveLengthRange(folder, pace.defaults);
  const fromFolder = !!folder && (folder.length_min_sec !== null || folder.length_max_sec !== null);
  return {
    folderId: folder?.id ?? null,
    folderName: folder?.name ?? null,
    range,
    fromFolder: fromFolder && range !== null,
    wpm: pace.wpm,
    dialogWords: range
      ? {
          min: range.minSec !== null ? dialogWordsFor(range.minSec, pace.wpm) : null,
          max: range.maxSec !== null ? dialogWordsFor(range.maxSec, pace.wpm) : null,
        }
      : null,
  };
}

function rangeText(range: LengthRange): string {
  if (range.minSec !== null && range.maxSec !== null) return `${formatClock(range.minSec)}-${formatClock(range.maxSec)}`;
  if (range.maxSec !== null) return `at most ${formatClock(range.maxSec)}`;
  return `at least ${formatClock(range.minSec ?? 0)}`;
}

function wordsText(words: NonNullable<WritingTarget["dialogWords"]>): string {
  if (words.min !== null && words.max !== null) return `about ${words.min}-${words.max} dialog words`;
  if (words.max !== null) return `at most about ${words.max} dialog words`;
  return `at least about ${words.min ?? 0} dialog words`;
}

/** One or two English lines for the model. */
export function describeTarget(target: WritingTarget): string {
  const where = target.folderName ? `folder "${target.folderName}"` : "no folder";
  const pace = `Speaking pace: ${target.wpm} words per minute of dialog, plus ${SECONDS_PER_DIRECTION_BLOCK} s per action block.`;
  if (!target.range) return `Working in ${where}; no length target is set. ${pace}`;
  const source = target.fromFolder ? "the folder's target" : "the default target";
  const words = target.dialogWords ? ` That is ${wordsText(target.dialogWords)} with a few action lines.` : "";
  return `Working in ${where}; length target ${rangeText(target.range)} (${source}).${words} ${pace}`;
}

/** Context for the tool `get_writing_context`. */
export function targetForTool(target: WritingTarget) {
  return {
    folder: target.folderName,
    folder_id: target.folderId,
    length_target: target.range ? rangeText(target.range) : null,
    length_target_seconds: target.range ? { min: target.range.minSec, max: target.range.maxSec } : null,
    target_source: target.range ? (target.fromFolder ? "folder" : "default") : null,
    dialog_words_per_minute: target.wpm,
    seconds_per_action_block: SECONDS_PER_DIRECTION_BLOCK,
    dialog_word_budget: target.dialogWords,
  };
}
