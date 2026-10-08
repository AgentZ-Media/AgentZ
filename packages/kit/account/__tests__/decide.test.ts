// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DecisionError, createDecider, parseDecisionAnswers, type DecisionRequest } from "../decide";
import { SessionExpiredError } from "../http";

const request: DecisionRequest = {
  state: { script: "[0] DIALOG (TIMO): Die Mauer ist 1989 gefallen." },
  questions: { b0: { type: "noul", instructions: "Does line [0] contain a checkable claim?", criteria: { true: "Yes.", false: "No." } } },
};

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("decide", () => {
  it("posts the request to /ai/decide and returns the parsed answers", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const decide = createDecider(async (path, init) => {
      calls.push({ path, init });
      return reply(200, { model: "typesafe/jev-1.13", answers: { b0: { type: "noul", noul: 0.97 } } })();
    });
    expect(await decide(request)).toEqual({ b0: { type: "noul", noul: 0.97 } });
    expect(calls[0].path).toBe("/ai/decide");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual(request);
  });

  it("maps backend errors to codes", async () => {
    const code = async (fetcher: Parameters<typeof createDecider>[0]) => {
      const error = await createDecider(fetcher)(request).catch((e: unknown) => e);
      return error instanceof DecisionError ? error.code : error;
    };
    expect(await code(reply(403, { error: "not_enabled" }))).toBe("not-enabled");
    expect(await code(reply(429, { error: "rate_limited" }))).toBe("rate-limited");
    expect(await code(reply(400, { error: "invalid_request" }))).toBe("invalid");
    expect(await code(reply(502, { error: "upstream_error" }))).toBe("unavailable");
    expect(await code(async () => { throw new SessionExpiredError(); })).toBe("signed-out");
    expect(await code(async () => { throw new TypeError("Failed to fetch"); })).toBe("network");
  });
});

describe("parseDecisionAnswers", () => {
  it("keeps well-formed answers of all three types and clamps probabilities", () => {
    expect(parseDecisionAnswers({
      answers: {
        a: { type: "noul", noul: 1.2 },
        b: { type: "choice", choice: "payments", confidence: 0.8, probabilities: { payments: 0.78, frontend: 0.22, x: "?" } },
        c: { type: "score", score: 1.99, confidence: null, probabilities: { 0: 0.01, 2: 0.99 } },
        d: { type: "noul" },
        e: "nope",
      },
    })).toEqual({
      a: { type: "noul", noul: 1 },
      b: { type: "choice", choice: "payments", confidence: 0.8, probabilities: { payments: 0.78, frontend: 0.22 } },
      c: { type: "score", score: 1.99, confidence: null, probabilities: { 0: 0.01, 2: 0.99 } },
    });
    expect(parseDecisionAnswers(null)).toEqual({});
  });
});
