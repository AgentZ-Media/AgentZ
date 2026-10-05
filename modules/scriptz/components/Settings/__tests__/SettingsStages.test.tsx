// Settings > Stufen (components/Settings/sections/SettingsStages.tsx):
// removing a stage moves its scripts to the neighbouring stage before the
// list is saved, renaming a built-in stage back to its default drops the
// own name, reordering changes which stage is "done", and the agent's learn
// stage moves on when its stage is removed.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import { settingsStore, startSettingsRuntime } from "../../../stores/settings";
import { scriptStages } from "../../../lib/stages";
import { agentSettings, startAgentSettingsRuntime } from "../../../stores/agentSettings";

const confirm = vi.fn(async () => true);
vi.mock("@agentz/kit/ui", async (orig) => ({
  ...(await orig<typeof import("@agentz/kit/ui")>()),
  confirmDialog: () => confirm(),
}));

const { SettingsStages } = await import("../sections/SettingsStages");

const originalAdapter = getTestStorage();
const calls: string[] = [];
const counts = new Map<string, number>();
let stopSettings: () => void;
let stopAgentSettings: () => void;

beforeAll(() => {
  const fake: Partial<TestStorage> = {
    setSetting: async (key, value) => {
      calls.push(`set:${key}=${value}`);
    },
    countScriptsWithStatus: async (status) => counts.get(status) ?? 0,
    reassignScriptStatus: async (from, to) => {
      calls.push(`move:${from}->${to}`);
      return counts.get(from) ?? 0;
    },
  };
  setTestStorage(
    new Proxy(fake as TestStorage, {
      get(target, prop: string) {
        return (target as unknown as Record<string, unknown>)[prop] ?? (async () => null);
      },
    }),
  );
});
afterAll(() => setTestStorage(originalAdapter));

beforeEach(async () => {
  stopSettings = startSettingsRuntime();
  stopAgentSettings = startAgentSettingsRuntime();
  await settingsStore.load();
  await agentSettings.load();
});
afterEach(() => {
  cleanup();
  stopSettings();
  stopAgentSettings();
  calls.length = 0;
  counts.clear();
  confirm.mockClear();
});

const tick = () => new Promise((r) => setTimeout(r, 0));

function rows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLLIElement>(".set-stage")];
}

function rowButton(row: HTMLElement, index: number) {
  return row.querySelectorAll<HTMLButtonElement>(".set-stage-acts button")[index];
}

describe("SettingsStages", () => {
  it("lists the pipeline and marks the last stage as done", () => {
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    const list = rows(container);
    expect(list).toHaveLength(4);
    expect(list[3].querySelector(".set-stage-tag")).not.toBeNull();
    expect(list[3].querySelector("svg.st")?.hasAttribute("data-done")).toBe(true);
    expect(list[2].querySelector("svg.st")?.hasAttribute("data-done")).toBe(false);
  });

  it("moves the scripts of a removed stage one stage back before saving", async () => {
    counts.set("online", 3);
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    rowButton(rows(container)[3], 2).click();
    await tick();
    await tick();
    expect(confirm).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      "move:online->shot",
      'set:script_stages=[{"id":"writing"},{"id":"ready"},{"id":"shot"}]',
    ]);
    expect(scriptStages().map((s) => s.id)).toEqual(["writing", "ready", "shot"]);
    // "Gedreht" is the new final stage.
    expect(rows(container)[2].querySelector("svg.st")?.hasAttribute("data-done")).toBe(true);
  });

  it("hands the scripts of the first stage forward and skips the dialog when empty", async () => {
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    rowButton(rows(container)[0], 2).click();
    await tick();
    await tick();
    expect(confirm).not.toHaveBeenCalled();
    expect(calls[0]).toBe("move:writing->ready");
    expect(scriptStages()[0].id).toBe("ready");
  });

  it("moves the agent's learn stage on to the next stage when it is removed", async () => {
    await agentSettings.setLearnStage("ready");
    calls.length = 0;
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    rowButton(rows(container)[1], 2).click();
    await tick();
    await tick();
    expect(calls).toEqual([
      "move:ready->writing",
      'set:script_stages=[{"id":"writing"},{"id":"shot"},{"id":"online"}]',
      "set:agent.learn_stage=shot",
    ]);
    expect(agentSettings.learnStage()).toBe("shot");
  });

  it("keeps nothing when the removal is cancelled", async () => {
    counts.set("ready", 1);
    confirm.mockResolvedValueOnce(false);
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    rowButton(rows(container)[1], 2).click();
    await tick();
    await tick();
    expect(calls).toEqual([]);
    expect(scriptStages()).toHaveLength(4);
  });

  it("renames, and a built-in name typed back to its default follows the language again", async () => {
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    const input = rows(container)[1].querySelector("input") as HTMLInputElement;
    input.value = "Fertig geschrieben";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    await tick();
    expect(scriptStages()[1]).toEqual({ id: "ready", label: "Fertig geschrieben" });
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    await tick();
    expect(scriptStages()[1]).toEqual({ id: "ready" });
  });

  it("reorders stages and adds new ones at the end", async () => {
    const { container } = render(() => <SettingsStages onClose={() => {}} />);
    rowButton(rows(container)[3], 0).click(); // online up
    await tick();
    expect(scriptStages().map((s) => s.id)).toEqual(["writing", "ready", "online", "shot"]);
    (container.querySelector(".set-stages-foot button") as HTMLButtonElement).click();
    await tick();
    expect(scriptStages()).toHaveLength(5);
    expect(scriptStages()[4].label).toBeTruthy();
  });
});
