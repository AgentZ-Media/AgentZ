// Pure helpers behind the script screen's timeline, inspector and focus
// pill. No Solid, no Lexical, no i18n - everything here is unit-tested in
// __tests__/timelineMath.test.ts.
//
// Inputs are the live `TimingBlock[]` (built from the editor state, with
// Lexical node keys) and the `TimelineSegment[]` that lib/timing.ts derives
// from them. Runtime numbers follow lib/runtime.ts exactly.

import type { LengthRange } from "../../lib/lengthGoal";
import {
  MIN_RUNTIME_SEC,
  SECONDS_PER_DIRECTION_BLOCK,
  wordCount,
} from "../../lib/runtime";
import type { TimelineSegment, TimingBlock } from "../../lib/timing";

/** Hook zone at the start of every short-form video. */
export const HOOK_SEC = 3;

/** The three hook marks after the first line of dialog, by priority:
 *  3 s decide whether anyone stays, 5 s whether it is clear what this is
 *  about, 10 s whether the conflict stands. */
export const HOOK_MARKS = [3, 5, 10] as const;
export type HookZone = 0 | 1 | 2;

export interface CastEntry {
  /** Uppercased character name. */
  name: string;
  /** Dialog words attributed to this character. */
  words: number;
  /** Whole-percent share of all dialog words (0 when there are none). */
  pct: number;
}

export interface LiveStats {
  /** Words across all blocks (action, character names, dialog,
   *  parentheticals). */
  words: number;
  /** Words in dialog blocks only. */
  dialogWords: number;
  /** Number of action blocks (each one is a 2 s beat). */
  actionBlocks: number;
  /** How often the speaker changes between consecutive dialog lines. */
  speakerChanges: number;
  /** Total runtime in whole seconds - identical to lib/runtime.ts. */
  runtimeSec: number;
  /** Characters in order of dialog share (desc), ties by first appearance. */
  cast: CastEntry[];
}

/** Aggregates everything the inspector and focus pill show. Speaker
 *  attribution matches lib/lex.ts::dialogWordsByCharacter: a dialog line
 *  belongs to the most recent character block above it, also across
 *  action and parenthetical blocks. Parentheticals count towards `words`
 *  only - like lib/runtime.ts they add neither dialog words nor a beat. */
export function liveStats(blocks: TimingBlock[], wpm: number): LiveStats {
  let words = 0;
  let dialogWords = 0;
  let actionBlocks = 0;
  let speakerChanges = 0;
  let current: string | null = null;
  let lastSpeaker: string | null | undefined;
  const byName = new Map<string, number>();

  for (const b of blocks) {
    const w = wordCount(b.text);
    words += w;
    if (b.kind === "character") {
      const name = b.text.trim().toUpperCase();
      current = name.length > 0 ? name : null;
      if (current && !byName.has(current)) byName.set(current, 0);
      continue;
    }
    if (b.kind === "action") {
      actionBlocks += 1;
      continue;
    }
    if (b.kind === "paren") continue;
    if (w === 0) continue;
    dialogWords += w;
    if (current) byName.set(current, (byName.get(current) ?? 0) + w);
    if (lastSpeaker !== undefined && lastSpeaker !== current) speakerChanges += 1;
    lastSpeaker = current;
  }

  const order = Array.from(byName.keys());
  const cast: CastEntry[] = order
    .map((name) => {
      const n = byName.get(name) ?? 0;
      return {
        name,
        words: n,
        pct: dialogWords > 0 ? Math.round((n / dialogWords) * 100) : 0,
      };
    })
    .sort((a, b) => b.words - a.words || order.indexOf(a.name) - order.indexOf(b.name));

  const safeWpm = Math.max(1, wpm);
  const rawSec = (dialogWords / safeWpm) * 60 + actionBlocks * SECONDS_PER_DIRECTION_BLOCK;
  const runtimeSec = Math.max(MIN_RUNTIME_SEC, Math.round(rawSec));

  return { words, dialogWords, actionBlocks, speakerChanges, runtimeSec, cast };
}

/** Visible time window of the timeline in seconds: the longer of runtime
 *  and the range bounds, plus a little air, rounded up to whole 10 s. */
export function timelineWindow(runtimeSec: number, range: LengthRange | null): number {
  const bounds = Math.max(range?.maxSec ?? 0, range?.minSec ?? 0);
  const longest = Math.max(runtimeSec, bounds, 0);
  return Math.max(10, Math.ceil((longest + 5) / 10) * 10);
}

const TICK_STEPS = [10, 15, 20, 30, 60, 120, 300, 600];

/** Axis ticks for a window: 10 s steps, coarser for long scripts so the
 *  axis never shows more than ~12 labels. Always starts at 0 and never
 *  includes the window end itself (the axis labels that separately). */
export function axisTicks(windowSec: number, maxTicks = 12): { step: number; ticks: number[] } {
  const w = Math.max(1, windowSec);
  const step = TICK_STEPS.find((s) => w / s <= maxTicks) ?? Math.ceil(w / maxTicks / 60) * 60;
  const ticks: number[] = [];
  for (let s = 0; s < w; s += step) ticks.push(s);
  return { step, ticks };
}

/** Percentage position of a time on the window, clamped to 0..100. */
export function pct(sec: number, windowSec: number): number {
  if (windowSec <= 0) return 0;
  return Math.min(100, Math.max(0, (sec / windowSec) * 100));
}

/** Total of all segment durations (unrounded), i.e. where the script ends
 *  on the timeline. */
export function segmentsEnd(segments: TimelineSegment[]): number {
  let end = 0;
  for (const s of segments) end = Math.max(end, s.startSec + s.durSec);
  return end;
}

/** Playhead position for the caret: the start time of the caret block or,
 *  if that block has no segment of its own (character line, empty
 *  dialog), of the next timed block below it. Past the last timed block
 *  the playhead sits at the end of the script. Without a caret block it
 *  sits at 0. */
export function playheadSec(
  blocks: TimingBlock[],
  segments: TimelineSegment[],
  caretKey: string | null,
): number {
  if (!caretKey) return 0;
  const startByKey = new Map<string, number>();
  for (const s of segments) if (s.key) startByKey.set(s.key, s.startSec);
  const idx = blocks.findIndex((b) => b.key === caretKey);
  if (idx < 0) return 0;
  for (let i = idx; i < blocks.length; i++) {
    const k = blocks[i].key;
    if (k && startByKey.has(k)) return startByKey.get(k) as number;
  }
  return segmentsEnd(segments);
}

/** Lane order for the expanded timeline: speakers in order of first
 *  appearance; `hasUnnamed` when dialog without a character exists. */
export function laneSpeakers(segments: TimelineSegment[]): { speakers: string[]; hasUnnamed: boolean } {
  const speakers: string[] = [];
  let hasUnnamed = false;
  for (const s of segments) {
    if (s.kind !== "dialog") continue;
    if (s.speaker === null) {
      hasUnnamed = true;
      continue;
    }
    if (!speakers.includes(s.speaker)) speakers.push(s.speaker);
  }
  return { speakers, hasUnnamed };
}

/** Key of the longest dialog segment (null if there is none or it has no
 *  key). Used to label the tooltip "longest line". */
export function longestDialogKey(segments: TimelineSegment[]): string | null {
  let best: TimelineSegment | null = null;
  for (const s of segments) {
    if (s.kind !== "dialog") continue;
    if (!best || s.durSec > best.durSec) best = s;
  }
  return best?.key ?? null;
}

/** Shortens a text to `max` characters on a word boundary, with an
 *  ellipsis. */
export function textStart(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()} …`;
}

/** Elapsed time bucket for "seit 2 Tagen" labels. */
export function sinceBucket(
  fromMs: number,
  nowMs: number,
): { unit: "now" | "minutes" | "hours" | "days"; count: number } {
  const diff = Math.max(0, nowMs - fromMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return { unit: "now", count: 0 };
  if (min < 60) return { unit: "minutes", count: min };
  const hours = Math.floor(min / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}

/** Keys of the speech run around the caret block: a character line with
 *  its parentheticals and dialog stay together (typewriter focus keeps the
 *  whole run bright). An action block stands alone. Unknown caret keys
 *  (a block created a moment ago) are returned on their own. */
export function speechGroupKeys(blocks: TimingBlock[], caretKey: string): string[] {
  const i = blocks.findIndex((b) => b.key === caretKey);
  if (i < 0 || blocks[i].kind === "action") return [caretKey];
  const inRun = (kind: TimingBlock["kind"]) => kind === "dialog" || kind === "paren";
  let start = i;
  if (blocks[i].kind !== "character") {
    while (start > 0 && inRun(blocks[start - 1].kind)) start--;
    if (start > 0 && blocks[start - 1].kind === "character") start--;
  }
  let end = i;
  while (end + 1 < blocks.length && inRun(blocks[end + 1].kind)) end++;
  return blocks.slice(start, end + 1).map((b) => b.key).filter((k): k is string => !!k);
}

/** When the hook clock starts: the first spoken line. Stage directions
 *  before it do not count. Null without dialog. */
export function firstDialogStart(segments: TimelineSegment[]): number | null {
  const first = segments.find((s) => s.kind === "dialog");
  return first ? first.startSec : null;
}

function zoneAt(rel: number): HookZone | null {
  if (rel < HOOK_MARKS[0]) return 0;
  if (rel < HOOK_MARKS[1]) return 1;
  if (rel < HOOK_MARKS[2]) return 2;
  return null;
}

export interface HookMarkData {
  /** Zone of every block that plays inside the first 10 s (character and
   *  parenthetical lines join their dialog). */
  zones: Map<string, HookZone>;
  /** Where the 3 / 5 / 10 s marks fall: block key and how far into that
   *  block (0..1). */
  ticks: Array<{ key: string; frac: number; sec: number }>;
}

/** Hook zones on the paper (3 / 5 / 10 s after the first line of
 *  dialog). Empty while the script has no dialog. */
export function hookMarks(blocks: TimingBlock[], segments: TimelineSegment[]): HookMarkData {
  const zones = new Map<string, HookZone>();
  const ticks: HookMarkData["ticks"] = [];
  const s0 = firstDialogStart(segments);
  if (s0 === null) return { zones, ticks };
  const byKey = new Map<string, TimelineSegment>();
  for (const s of segments) if (s.key) byKey.set(s.key, s);
  let pending: string[] = [];
  for (const b of blocks) {
    if (!b.key) continue;
    if (b.kind === "character" || b.kind === "paren") {
      pending.push(b.key);
      continue;
    }
    const seg = byKey.get(b.key);
    if (seg && seg.startSec >= s0) {
      const zone = zoneAt(seg.startSec - s0);
      if (zone !== null) {
        if (b.kind === "dialog") for (const key of pending) zones.set(key, zone);
        zones.set(b.key, zone);
      }
    }
    pending = [];
  }
  for (const sec of HOOK_MARKS) {
    const at = s0 + sec;
    const seg = segments.find((s) => s.key && s.startSec <= at && at < s.startSec + s.durSec);
    if (seg?.key) ticks.push({ key: seg.key, frac: seg.durSec > 0 ? (at - seg.startSec) / seg.durSec : 0, sec });
  }
  return { zones, ticks };
}
