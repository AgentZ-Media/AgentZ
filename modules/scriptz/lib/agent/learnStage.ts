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

/** Stored value after the pipeline changed from `before` to `after`, or null
 *  when it stays. An explicit learn stage only lives between the first and
 *  the last stage, so the selector never hides a stored choice: a removed
 *  stage moves on to the next remaining one (learning still waits at least
 *  as long), and one that ends up first or last returns to the default. */
export function learnStageAfterChange(stored: string, before: readonly StageDef[], after: readonly StageDef[]): string | null {
  if (!stored) return null;
  const inMiddle = (id: string) => after.slice(1, -1).some((s) => s.id === id);
  if (inMiddle(stored)) return null;
  let next = stored;
  if (!after.some((s) => s.id === stored)) {
    const i = before.findIndex((s) => s.id === stored);
    next = i < 0 ? "" : before.slice(i + 1).find((s) => after.some((a) => a.id === s.id))?.id ?? "";
  }
  return next && inMiddle(next) ? next : "";
}
