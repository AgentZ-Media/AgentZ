import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CHECK_MODEL, DEFAULT_MODEL, chatModel, checkModel, modelFor } from "../convex/aiModels.ts";

describe("hosted agent models", () => {
  it("falls back to the defaults and names them", () => {
    assert.deepEqual(chatModel(""), { id: DEFAULT_MODEL, label: "GPT-6.1 Sol" });
    assert.deepEqual(checkModel(undefined), { id: DEFAULT_CHECK_MODEL, label: "GPT-6 Luna" });
    assert.deepEqual(chatModel(" vendor/other "), { id: "vendor/other", label: "vendor/other" });
  });

  it("lets an app ask for the check model and nothing else", () => {
    const chat = chatModel("");
    const check = checkModel("");
    assert.equal(modelFor(DEFAULT_CHECK_MODEL, chat, check), DEFAULT_CHECK_MODEL);
    assert.equal(modelFor(DEFAULT_MODEL, chat, check), DEFAULT_MODEL);
    // Older apps send the chat model they were told; anything else runs on it too.
    assert.equal(modelFor("openai/gpt-6-astra", chat, check), DEFAULT_MODEL);
    assert.equal(modelFor(undefined, chat, check), DEFAULT_MODEL);
  });
});
