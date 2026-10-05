// What a proposal would do to the script, before the writer clicks it:
// runtime, speaker changes, longest line and - for "Einstieg prüfen" - how
// many seconds after the first line of dialog the conflict becomes clear.
// Pure; the numbers follow lib/runtime.ts and lib/timing.ts exactly.

import { computeTimeline, type TimingBlock } from "../../lib/timing";
import { resolveTarget, type Proposal, type ProposalTarget } from "../../lib/agent/proposals";
import type { AgentBlock } from "../../lib/agent/scriptText";
import { liveStats, playheadSec } from "../Script/timelineMath";

export interface ScriptMeasure {
  runtimeSec: number;
  speakerChanges: number;
  /** Duration of the longest dialog line in seconds (0 without dialog). */
  longestSec: number;
  /** Seconds from the first line of dialog to the conflict block; null
   *  when unknown. */
  conflictSec: number | null;
}

export interface OptionMetrics {
  before: ScriptMeasure;
  after: ScriptMeasure;
}

function timingBlocks(blocks: readonly AgentBlock[]): TimingBlock[] {
  return blocks.map((block, i) => ({
    key: String(i),
    kind: block.type === "parenthetical" ? "paren" : block.type,
    text: block.text,
  }));
}

export function measureBlocks(blocks: readonly AgentBlock[], wpm: number, conflictIndex: number | null = null): ScriptMeasure {
  const timing = timingBlocks(blocks);
  const stats = liveStats(timing, wpm);
  const segments = computeTimeline(timing, wpm);
  let longest = 0;
  for (const s of segments) if (s.kind === "dialog") longest = Math.max(longest, s.durSec);
  const first = segments.find((s) => s.kind === "dialog");
  let conflictSec: number | null = null;
  if (conflictIndex !== null && first && conflictIndex >= 0 && conflictIndex < blocks.length) {
    conflictSec = Math.max(0, playheadSec(timing, segments, String(conflictIndex)) - first.startSec);
  }
  return { runtimeSec: stats.runtimeSec, speakerChanges: stats.speakerChanges, longestSec: longest, conflictSec };
}

/** The script with an option applied at a target that was already
 *  resolved against `current`. */
export function applyOption(current: readonly AgentBlock[], target: ProposalTarget, blocks: readonly AgentBlock[]): AgentBlock[] {
  if (target.mode === "replace") return [...current.slice(0, target.from), ...blocks, ...current.slice(target.to + 1)];
  if (target.mode === "insertAfter") return [...current.slice(0, target.block + 1), ...blocks, ...current.slice(target.block + 1)];
  return [...current, ...blocks];
}

/** Before/after numbers for one option, or null when the targeted lines
 *  changed since the proposal (it could not be applied either). */
export function optionMetrics(current: readonly AgentBlock[], proposal: Proposal, index: number, wpm: number): OptionMetrics | null {
  const option = proposal.options[index];
  if (!option) return null;
  const target = resolveTarget(proposal.target, current.map((b) => b.text));
  if (!target) return null;
  const after = applyOption(current, target, option.blocks);
  const start = target.mode === "replace" ? target.from : target.mode === "insertAfter" ? target.block + 1 : current.length;
  const conflictAfter = option.conflictBlock === undefined ? null : start + option.conflictBlock;
  return {
    before: measureBlocks(current, wpm, proposal.currentConflict ?? null),
    after: measureBlocks(after, wpm, conflictAfter),
  };
}
