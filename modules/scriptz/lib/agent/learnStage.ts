// Stage from which the agent learns finished scripts (Settings > Agent).
// The setting `agent.learn_stage` stores a stage id; empty means "the last
// stage" and follows reordering and new stages. Scripts at that stage or any
// later one count as finished for learning.

import type { StageDef } from "../stages";

/** Effective learn stage for a stored value. Unknown ids (stage removed,
 *  settings from another install) and the first stage (where every draft
 *  starts) fall back to the last stage. */
export function resolveLearnStage(stored: string, list: readonly StageDef[]): string {
  if (stored && list.slice(1).some((s) => s.id === stored)) return stored;
  return list[list.length - 1].id;
}

/** Stage ids at or after the learn stage, in pipeline order. */
export function learnStageIds(stored: string, list: readonly StageDef[]): string[] {
  const from = list.findIndex((s) => s.id === resolveLearnStage(stored, list));
  return list.slice(from).map((s) => s.id);
}

/** Stored value after `removedId` leaves the pipeline: the learn stage moves
 *  on to the next stage, so learning still waits at least as long. Returns
 *  null when the setting is unaffected. */
export function learnStageAfterRemoval(stored: string, removedId: string, list: readonly StageDef[]): string | null {
  if (!stored || stored !== removedId) return null;
  const i = list.findIndex((s) => s.id === removedId);
  const next = i >= 0 ? list[i + 1] : undefined;
  // The next stage is the last one: back to the default, which follows it.
  return next && i + 1 < list.length - 1 ? next.id : "";
}
