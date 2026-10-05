import { describe, expect, it } from "vitest";
import { DEFAULT_STAGES, type StageDef } from "../../stages";
import { learnStageAfterChange, learnStageIds, resolveLearnStage } from "../learnStage";

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
    const without = (list: readonly StageDef[], id: string) => list.filter((s) => s.id !== id);
    expect(learnStageAfterChange("ready", custom, without(custom, "ready"))).toBe("c-1");
    expect(learnStageAfterChange("ready", DEFAULT_STAGES, without(DEFAULT_STAGES, "ready"))).toBe("shot");
    // The next stage is the last one: back to the default.
    expect(learnStageAfterChange("shot", DEFAULT_STAGES, without(DEFAULT_STAGES, "shot"))).toBe("");
    // Other stages and the default are unaffected.
    expect(learnStageAfterChange("ready", DEFAULT_STAGES, without(DEFAULT_STAGES, "shot"))).toBeNull();
    expect(learnStageAfterChange("", DEFAULT_STAGES, without(DEFAULT_STAGES, "online"))).toBeNull();
  });

  it("returns to the default when the chosen stage ends up first or last", () => {
    // "online" removed: "shot" is the last stage now and must not stay
    // stored, or a stage added later would still learn from "shot".
    expect(learnStageAfterChange("shot", DEFAULT_STAGES, DEFAULT_STAGES.filter((s) => s.id !== "online"))).toBe("");
    const shotLast: StageDef[] = [{ id: "writing" }, { id: "ready" }, { id: "online" }, { id: "shot" }];
    expect(learnStageAfterChange("shot", DEFAULT_STAGES, shotLast)).toBe("");
    const readyFirst: StageDef[] = [{ id: "ready" }, { id: "writing" }, { id: "shot" }, { id: "online" }];
    expect(learnStageAfterChange("ready", DEFAULT_STAGES, readyFirst)).toBe("");
    expect(learnStageAfterChange("gone", DEFAULT_STAGES, DEFAULT_STAGES)).toBe("");
    // Adding a stage at the end keeps an explicit choice.
    expect(learnStageAfterChange("shot", DEFAULT_STAGES, [...DEFAULT_STAGES, { id: "c-2", label: "Archiv" }])).toBeNull();
  });
});
