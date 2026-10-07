// Decision requests of the apps (POST /ai/decide in ai.ts): typed questions
// about a text, answered by a decision model with probabilities instead of
// prose (OpenRouter Decisions API, Jev by TypeSafe). Product-neutral: any app
// of the suite sends its own questions; only their shape is checked here.
// Pure functions, no Convex imports (tests/decisions.test.mjs).

export const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
/** Fallback when DECISION_MODEL is not set. */
export const DEFAULT_DECISION_MODEL = "typesafe/jev-1.13";

/** Questions per request; Jev answers them in parallel. */
export const MAX_QUESTIONS = 200;
/** Options of a choice question (the model's own limit). */
export const MAX_CHOICES = 255;
/** Levels of a score question. */
export const MAX_LEVELS = 10;
/** The text the questions are about (Jev reads up to 32k tokens of it). */
export const MAX_STATE_CHARS = 120_000;
export const MAX_INSTRUCTIONS_CHARS = 2_000;
export const MAX_CRITERION_CHARS = 1_000;
/** The whole request as it arrives and as it goes upstream. */
export const MAX_DECISION_BODY_CHARS = 600_000;

const KEY = /^[A-Za-z0-9_-]{1,64}$/;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value : null;

export function decisionModel(env: string | undefined = process.env.DECISION_MODEL): string {
  return env?.trim() || DEFAULT_DECISION_MODEL;
}

/** One question in the upstream shape, or null when it is not usable. */
function question(raw: unknown): Json | null {
  if (!isObject(raw)) return null;
  const instructions = text(raw.instructions, MAX_INSTRUCTIONS_CHARS);
  if (!instructions) return null;
  const criteria = raw.criteria;
  switch (raw.type) {
    case "noul": {
      if (!isObject(criteria)) return null;
      const yes = text(criteria.true, MAX_CRITERION_CHARS);
      const no = text(criteria.false, MAX_CRITERION_CHARS);
      return yes && no ? { type: "noul", instructions, criteria: { true: yes, false: no } } : null;
    }
    case "choice": {
      if (!isObject(criteria)) return null;
      const entries = Object.entries(criteria);
      if (entries.length < 2 || entries.length > MAX_CHOICES) return null;
      const out: Record<string, string> = {};
      for (const [key, value] of entries) {
        const described = text(value, MAX_CRITERION_CHARS);
        if (!KEY.test(key) || !described) return null;
        out[key] = described;
      }
      return { type: "choice", instructions, criteria: out };
    }
    case "score": {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > MAX_LEVELS) return null;
      const levels = criteria.map((level) => text(level, MAX_CRITERION_CHARS));
      return levels.every(Boolean) ? { type: "score", instructions, criteria: levels } : null;
    }
    default:
      return null;
  }
}

/** The upstream request, or null for anything that is not a well-formed
 *  decision request. The model is always the server's. */
export function decisionBody(raw: unknown, model = decisionModel()): Json | null {
  if (!isObject(raw)) return null;
  const state = raw.state;
  if (typeof state === "string") {
    if (!state.trim() || state.length > MAX_STATE_CHARS) return null;
  } else if (isObject(state)) {
    if (JSON.stringify(state).length > MAX_STATE_CHARS) return null;
  } else {
    return null;
  }
  if (!isObject(raw.questions)) return null;
  const entries = Object.entries(raw.questions);
  if (entries.length === 0 || entries.length > MAX_QUESTIONS) return null;
  const questions: Json = {};
  for (const [key, value] of entries) {
    const parsed = KEY.test(key) ? question(value) : null;
    if (!parsed) return null;
    questions[key] = parsed;
  }
  return { model, state, questions };
}

/** What the app gets back: the answers and the model, nothing about cost. */
export function decisionResult(raw: unknown): Json | null {
  if (!isObject(raw) || !isObject(raw.answers)) return null;
  return { model: typeof raw.model === "string" ? raw.model : null, answers: raw.answers };
}
