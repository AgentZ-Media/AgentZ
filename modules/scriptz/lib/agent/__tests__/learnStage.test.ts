import { describe, expect, it } from "vitest";
import { DEFAULT_STAGES, type StageDef } from "../../stages";
import { learnStageAfterRemoval, learnStageIds, resolveLearnStage } from "../learnStage";

const custom: StageDef[] = [{ id: "writing" }, { id: "ready" }, { id: "c-1", label: "Schnitt" }, { id: "shot" }, { id: "online" }];

describe("learn stage", () => {
  it("defaults to the last stage and follows it", () => {
    expect(resolveLearnStage("", DEFAULT_STAGES)).toBe("online");
    expect(learnStageIds("", DEFAULT_STAGES)).toEqual(["online"]);
    expect(resolveLearnStage("", [...DEFAULT_STAGES, { id: "c-2", label: "Archiv" }])).toBe("c-2");
  });

  it("learns from the chosen stage and every later one", () => {
    expect(resolveLearnStage("ready", DEFAULT_STAGES)).toBe("ready");
    expect(learnStageIds("ready", DEFAULT_STAGES)).toEqual(["ready", "shot", "online"]);
    expect(learnStageIds("ready", custom)).toEqual(["ready", "c-1", "shot", "online"]);
  });

  it("follows the chosen stage when the pipeline is reordered", () => {
    const reordered: StageDef[] = [{ id: "writing" }, { id: "shot" }, { id: "ready" }, { id: "online" }];
    expect(learnStageIds("ready", reordered)).toEqual(["ready", "online"]);
  });

  it("falls back to the last stage for removed ids and the first stage", () => {
    expect(resolveLearnStage("gone", DEFAULT_STAGES)).toBe("online");
    expect(resolveLearnStage("writing", DEFAULT_STAGES)).toBe("online");
    const ready: StageDef[] = [{ id: "ready" }, { id: "writing" }, { id: "online" }];
    expect(learnStageIds("ready", ready)).toEqual(["online"]);
  });

  it("moves on to the next stage when its stage is removed", () => {
    expect(learnStageAfterRemoval("ready", "ready", custom)).toBe("c-1");
    // The next stage is the last one: back to the default.
    expect(learnStageAfterRemoval("ready", "ready", DEFAULT_STAGES)).toBe("shot");
    expect(learnStageAfterRemoval("shot", "shot", DEFAULT_STAGES)).toBe("");
    // Other stages and the default are unaffected.
    expect(learnStageAfterRemoval("ready", "shot", DEFAULT_STAGES)).toBeNull();
    expect(learnStageAfterRemoval("", "online", DEFAULT_STAGES)).toBeNull();
  });
});
