// Checkable claims on the paper: which dialog lines a decision model (Jev,
// through the suite backend, @agentz/kit/account `decide`) should look at,
// and the questions it gets. Opening a script sends the whole script with one
// yes/no question per line; an edited line goes alone with up to two dialog
// lines before and after it, because a short line often only completes a
// claim made just before ("Von 1963." after "Das Gesetz ist doch uralt.").
// Pure functions; the runtime lives in stores/agent/claims.ts.

import type { DecisionAnswer, DecisionRequest, NoulQuestion } from "@agentz/kit/account";
import { numberedScript, type AgentBlock } from "./scriptText";

/** Shorter lines ("Hmm.", "Ja, klar.") are never asked about. */
export const CLAIM_MIN_WORDS = 4;
/** Probability from which a line is marked. Measured on real scripts: above
 *  it sat laws, numbers, dates and news, below it scene facts and jokes. */
export const CLAIM_THRESHOLD = 0.8;
/** Dialog lines before and after an edited line that go with it. */
export const CLAIM_CONTEXT = 2;
/** Questions per request (the backend allows 200). */
export const CLAIM_BATCH = 100;

/** Worded and measured on German sketch scripts: real-world facts count,
 *  facts about the scene itself (the room, the characters) do not. */
const CRITERIA: NoulQuestion["criteria"] = {
  true: "The line asserts something about the real world outside the scene (laws, rules, statistics, history, science, real people, parties, places or news events) that a fact-checker could verify against public sources.",
  false: "The line is a joke, opinion, question, insult, small talk, or only about the fictional scene itself (the room, the characters, what they did or own, their contracts or plans).",
};

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Dialog lines long enough to hold a claim, by block index. */
export function claimCandidates(blocks: readonly AgentBlock[]): number[] {
  const out: number[] = [];
  blocks.forEach((block, index) => {
    if (block.type === "dialog" && words(block.text) >= CLAIM_MIN_WORDS) out.push(index);
  });
  return out;
}

/** Stable key of a line's text: results and dismissals follow the text, so
 *  an edited line is asked about again and a moved one keeps its result. */
export function claimKey(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = (h2 * 31 + c) | 0;
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${normalized.length.toString(36)}`;
}

const question = (index: number): NoulQuestion => ({
  type: "noul",
  instructions: `Does line [${index}] of SCRIPT contain a checkable factual claim? A short line can complete a claim from the lines just before it.`,
  criteria: CRITERIA,
});

const questionKey = (index: number) => `b${index}`;

/** The whole script, one question per target line (in batches). */
export function scriptRequests(blocks: readonly AgentBlock[], targets: readonly number[]): DecisionRequest[] {
  if (targets.length === 0) return [];
  const script = numberedScript(blocks);
  const out: DecisionRequest[] = [];
  for (let i = 0; i < targets.length; i += CLAIM_BATCH) {
    const questions: DecisionRequest["questions"] = {};
    for (const index of targets.slice(i, i + CLAIM_BATCH)) questions[questionKey(index)] = question(index);
    out.push({ state: { script }, questions });
  }
  return out;
}

/** Block range around a line: `CLAIM_CONTEXT` dialog lines before and after
 *  it, with the character names above the first one. */
export function claimWindow(blocks: readonly AgentBlock[], index: number): { from: number; to: number } {
  const dialogs: number[] = [];
  blocks.forEach((block, i) => { if (block.type === "dialog") dialogs.push(i); });
  const at = dialogs.indexOf(index);
  if (at < 0) return { from: index, to: index };
  let from = dialogs[Math.max(0, at - CLAIM_CONTEXT)];
  const to = dialogs[Math.min(dialogs.length - 1, at + CLAIM_CONTEXT)];
  while (from > 0 && (blocks[from - 1].type === "character" || blocks[from - 1].type === "parenthetical")) from -= 1;
  return { from, to };
}

/** One edited line with its neighbours; lines keep their script numbers. */
export function lineRequest(blocks: readonly AgentBlock[], index: number): DecisionRequest {
  const { from, to } = claimWindow(blocks, index);
  const script = numberedScript(blocks).split("\n").slice(from, to + 1).join("\n");
  return { state: { script }, questions: { [questionKey(index)]: question(index) } };
}

/** Probability per block index from the answers of a request. */
export function claimProbabilities(answers: Record<string, DecisionAnswer>): Map<number, number> {
  const out = new Map<number, number>();
  for (const [key, answer] of Object.entries(answers)) {
    const index = /^b(\d+)$/.exec(key);
    if (index && answer.type === "noul") out.set(Number(index[1]), answer.noul);
  }
  return out;
}
