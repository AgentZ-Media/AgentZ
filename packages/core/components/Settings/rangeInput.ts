// Glue between the two "von / bis" text fields of a target range and the
// storage layer: parses both fields with `parseClock` and checks the order.
// Pure, so the settings UI can show the exact field + reason on error.

import { formatClock, parseClock } from "../../lib/lengthGoal";

export type RangeParseResult =
  | { ok: true; minSec: number | null; maxSec: number | null }
  | { ok: false; field: "min" | "max"; reason: "format" | "order" };

/** Parses the typed bounds. Empty field = bound unset (null). */
export function parseRangeInput(minText: string, maxText: string): RangeParseResult {
  const min = parseClock(minText);
  if (min === undefined) return { ok: false, field: "min", reason: "format" };
  const max = parseClock(maxText);
  if (max === undefined) return { ok: false, field: "max", reason: "format" };
  if (min !== null && max !== null && min >= max) {
    return { ok: false, field: "max", reason: "order" };
  }
  return { ok: true, minSec: min, maxSec: max };
}

/** Field text for a stored bound: "m:ss" or "" when unset. */
export function boundText(sec: number | null): string {
  return sec === null ? "" : formatClock(sec);
}
