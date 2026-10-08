import { account } from "./account";
import { SessionExpiredError } from "./http";

// Decision requests through the suite backend (POST /ai/decide,
// apps/site/convex/decisions.ts): typed questions about a text, answered by a
// decision model (Jev) with probabilities instead of prose. Product-neutral:
// an app sends its own questions with the account session; the backend holds
// the key and picks the model. Open to the same accounts as the hosted agent
// (AI_ACCESS); everyone else gets "not-enabled".

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option key -> what it means (2 to 255 options). */
  criteria: Record<string, string>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered levels, lowest first (2 to 10). */
  criteria: string[];
}

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface DecisionRequest {
  /** What the questions are about. */
  state: string | Record<string, unknown>;
  /** Question key ([A-Za-z0-9_-], up to 64 characters) -> question. All are
   *  answered in parallel and cannot see each other's answers. */
  questions: Record<string, DecisionQuestion>;
}

export type DecisionAnswer =
  | { type: "noul"; /** Probability of "yes". */ noul: number }
  | { type: "choice"; choice: string; confidence: number | null; probabilities: Record<string, number> }
  | { type: "score"; score: number; confidence: number | null; probabilities: Record<string, number> };

export type DecisionErrorCode = "signed-out" | "not-enabled" | "rate-limited" | "network" | "unavailable" | "invalid";

export class DecisionError extends Error {
  constructor(readonly code: DecisionErrorCode, message: string = code) {
    super(message);
    this.name = "DecisionError";
  }
}

/** Authorized request to the suite backend (`path` below its site URL). */
export type BackendFetch = (path: string, init: RequestInit) => Promise<Response>;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const probability = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

function probabilities(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObject(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      const p = probability(value);
      if (p !== null) out[key] = p;
    }
  }
  return out;
}

function answer(raw: unknown): DecisionAnswer | null {
  if (!isObject(raw)) return null;
  if (raw.type === "noul") {
    const p = probability(raw.noul);
    return p === null ? null : { type: "noul", noul: p };
  }
  if (raw.type === "choice" && typeof raw.choice === "string") {
    return { type: "choice", choice: raw.choice, confidence: probability(raw.confidence), probabilities: probabilities(raw.probabilities) };
  }
  if (raw.type === "score" && typeof raw.score === "number" && Number.isFinite(raw.score)) {
    return { type: "score", score: raw.score, confidence: probability(raw.confidence), probabilities: probabilities(raw.probabilities) };
  }
  return null;
}

/** The usable answers of a backend response; questions without one are
 *  missing from the result. */
export function parseDecisionAnswers(raw: unknown): Record<string, DecisionAnswer> {
  const out: Record<string, DecisionAnswer> = {};
  const answers = isObject(raw) ? raw.answers : null;
  if (!isObject(answers)) return out;
  for (const [key, value] of Object.entries(answers)) {
    const parsed = answer(value);
    if (parsed) out[key] = parsed;
  }
  return out;
}

async function errorOf(response: Response): Promise<DecisionError> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  const detail = typeof body?.error === "string" ? body.error : `request failed (${response.status})`;
  if (response.status === 403 && detail === "not_enabled") return new DecisionError("not-enabled");
  if (response.status === 429) return new DecisionError("rate-limited");
  if (response.status === 400 || response.status === 413) return new DecisionError("invalid", detail);
  return new DecisionError("unavailable", detail);
}

/** `decide` against any backend fetch (tests, other hosts). */
export function createDecider(fetcher: BackendFetch) {
  return async function decide(request: DecisionRequest, options: { signal?: AbortSignal } = {}): Promise<Record<string, DecisionAnswer>> {
    let response: Response;
    try {
      response = await fetcher("/ai/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (error instanceof SessionExpiredError) throw new DecisionError("signed-out");
      throw new DecisionError("network", error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) throw await errorOf(response);
    return parseDecisionAnswers(await response.json().catch(() => null));
  };
}

/** Asks the decision model with the signed-in account's session. Throws
 *  `DecisionError` ("signed-out" without a session). */
export function decide(request: DecisionRequest, options: { signal?: AbortSignal } = {}): Promise<Record<string, DecisionAnswer>> {
  if (!account.signedIn()) return Promise.reject(new DecisionError("signed-out"));
  return createDecider((path, init) => account.backendFetch(path, init))(request, options);
}
