// Length goal as a target range.
//
// Resolution order: folder range -> global default range -> none. Both
// bounds are optional; comparisons run in whole seconds and the delta is
// always reported to the nearest violated bound (over: to max, under: to
// min). "Under" is information, never an error - the UI renders it muted,
// only "over" uses the warn colour.
//
// `formatRange` returns a ready string through the i18n catalog
// (`length.range.*`), e.g. "0:45-1:05", "bis 1:00" / "up to 1:00",
// "ab 0:45" / "from 0:45". Empty string when no bound is set. Keeping the
// wording in the catalog means a typographic change (hyphen vs. en dash)
// is a one-line edit.

import type { Folder } from "./types";
import { t } from "../i18n";

export type LengthRange = { minSec: number | null; maxSec: number | null };

export type LengthState = "none" | "under" | "in" | "over";

function cleanBound(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function sanitize(range: LengthRange): LengthRange | null {
  const minSec = cleanBound(range.minSec);
  const maxSec = cleanBound(range.maxSec);
  if (minSec === null && maxSec === null) return null;
  // An inverted pair can't come from storage (validated on write), but a
  // default typed half-way through editing could. Keep the upper bound -
  // it's the one that matters most ("not longer than").
  if (minSec !== null && maxSec !== null && minSec >= maxSec) {
    return { minSec: null, maxSec };
  }
  return { minSec, maxSec };
}

/** True when the folder carries its own range (at least one bound). The UI
 *  uses this to show where a range comes from (e.g. the folder name). */
export function folderHasLengthRange(folder: Folder | null | undefined): boolean {
  if (!folder) return false;
  return cleanBound(folder.length_min_sec) !== null || cleanBound(folder.length_max_sec) !== null;
}

/** Effective range for a script: its folder's range if the folder has one,
 *  otherwise the global defaults, otherwise null (no range). */
export function resolveLengthRange(
  folder: Folder | null,
  defaults: LengthRange,
): LengthRange | null {
  if (folder && folderHasLengthRange(folder)) {
    return sanitize({ minSec: folder.length_min_sec, maxSec: folder.length_max_sec });
  }
  return sanitize(defaults);
}

/** Where `runtimeSec` sits relative to `range`. `deltaSec` is a positive
 *  whole number of seconds to the nearest violated bound, 0 for "in" and
 *  "none". */
export function lengthStatus(
  runtimeSec: number,
  range: LengthRange | null,
): { state: LengthState; deltaSec: number } {
  const r = range ? sanitize(range) : null;
  if (!r) return { state: "none", deltaSec: 0 };
  const sec = Math.round(Math.max(0, runtimeSec));
  if (r.maxSec !== null && sec > r.maxSec) {
    return { state: "over", deltaSec: sec - r.maxSec };
  }
  if (r.minSec !== null && sec < r.minSec) {
    return { state: "under", deltaSec: r.minSec - sec };
  }
  return { state: "in", deltaSec: 0 };
}

/** "m:ss" clock format for whole seconds, e.g. 75 -> "1:15", 5 -> "0:05". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** Human-readable range via i18n. "" when no bound is set. */
export function formatRange(range: LengthRange | null): string {
  const r = range ? sanitize(range) : null;
  if (!r) return "";
  if (r.minSec !== null && r.maxSec !== null) {
    return t("length.range.both", { min: formatClock(r.minSec), max: formatClock(r.maxSec) });
  }
  if (r.maxSec !== null) return t("length.range.maxOnly", { max: formatClock(r.maxSec) });
  return t("length.range.minOnly", { min: formatClock(r.minSec as number) });
}

/** Parses a user-typed duration ("1:05", "65", "0:45", "") into whole
 *  seconds. Empty input = null (bound unset). Returns undefined for input
 *  that isn't a valid duration, so forms can show an error. */
export function parseClock(input: string): number | null | undefined {
  const s = input.trim();
  if (s.length === 0) return null;
  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d{1,5}$/.test(s)) return Number(s);
  return undefined;
}
