import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DECISION_MODEL, MAX_CHOICES, MAX_QUESTIONS, MAX_STATE_CHARS, decisionBody, decisionModel, decisionResult,
} from "../convex/decisions.ts";

const noul = { type: "noul", instructions: "Does LINE contain a checkable claim?", criteria: { true: "It does.", false: "It does not." } };

describe("decisionBody", () => {
  it("passes the three question types and always sets the server's model", () => {
    const body = decisionBody({
      model: "openai/gpt-6",
      state: { script: "[0] DIALOG (TIMO): Die Mauer ist 1989 gefallen." },
      questions: {
        b0: noul,
        team: { type: "choice", instructions: "Which team?", criteria: { payments: "Billing.", frontend: "Layout." } },
        urgency: { type: "score", instructions: "How urgent?", criteria: ["Later", "This week", "Now"] },
      },
      provider: { order: ["x"] },
    }, "typesafe/jev-1.13");
    assert.deepEqual(Object.keys(body), ["model", "state", "questions"]);
    assert.equal(body.model, "typesafe/jev-1.13");
    assert.deepEqual(Object.keys(body.questions), ["b0", "team", "urgency"]);
    assert.deepEqual(body.questions.b0, noul);
  });

  it("accepts a plain text state", () => {
    assert.ok(decisionBody({ state: "Some text", questions: { q: noul } }));
  });

  it("rejects malformed requests", () => {
    const bad = [
      null,
      [],
      { questions: { q: noul } },
      { state: "", questions: { q: noul } },
      { state: 42, questions: { q: noul } },
      { state: "x".repeat(MAX_STATE_CHARS + 1), questions: { q: noul } },
      { state: { text: "x".repeat(MAX_STATE_CHARS) }, questions: { q: noul } },
      { state: "x", questions: {} },
      { state: "x", questions: [] },
      { state: "x", questions: { "bad key": noul } },
      { state: "x", questions: { q: { ...noul, type: "essay" } } },
      { state: "x", questions: { q: { ...noul, instructions: " " } } },
      { state: "x", questions: { q: { ...noul, criteria: { true: "yes" } } } },
      { state: "x", questions: { q: { type: "choice", instructions: "?", criteria: { only: "One option." } } } },
      { state: "x", questions: { q: { type: "score", instructions: "?", criteria: ["Just one"] } } },
      { state: "x", questions: { q: { type: "score", instructions: "?", criteria: ["a", 2] } } },
    ];
    for (const raw of bad) assert.equal(decisionBody(raw), null, JSON.stringify(raw)?.slice(0, 80));
  });

  it("caps the number of questions and choices", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => [`q${i}`, noul]));
    assert.equal(decisionBody({ state: "x", questions: many }), null);
    const options = Object.fromEntries(Array.from({ length: MAX_CHOICES + 1 }, (_, i) => [`o${i}`, "Option."]));
    assert.equal(decisionBody({ state: "x", questions: { q: { type: "choice", instructions: "?", criteria: options } } }), null);
  });
});

describe("decisionModel", () => {
  it("falls back to Jev", () => {
    assert.equal(decisionModel(undefined), DEFAULT_DECISION_MODEL);
    assert.equal(decisionModel("  "), DEFAULT_DECISION_MODEL);
    assert.equal(decisionModel("typesafe/jev-1.14"), "typesafe/jev-1.14");
  });
});

describe("decisionResult", () => {
  it("returns answers and model, drops usage and cost", () => {
    const result = decisionResult({ id: "x", model: "typesafe/jev-1.13", answers: { b0: { type: "noul", noul: 0.9 } }, usage: { cost: 0.00001 } });
    assert.deepEqual(result, { model: "typesafe/jev-1.13", answers: { b0: { type: "noul", noul: 0.9 } } });
    assert.equal(decisionResult({ error: "nope" }), null);
  });
});
