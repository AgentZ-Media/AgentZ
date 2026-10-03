// Selection mode of the ideas page (components/Ideas/IdeasPage.tsx):
// checkboxes, "select all" (skips collapsed groups), group checkboxes,
// shift ranges, the bulk "into scripts" action with a target stage, and
// how it interacts with rows that open in place.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import type { Idea, ScriptSummary } from "../../../lib/types";
import { ideasStore, startIdeasStore } from "../../../stores/ideas";
import { navStore } from "../../../stores/nav";
import { t } from "../../../i18n";
import { IdeasPage } from "../IdeasPage";

const originalAdapter = getTestStorage();
let stopIdeas: () => void;

const now = Date.now();
const longAgo = new Date(new Date().getFullYear() - 1, 0, 1).getTime();

function idea(id: string, created_at: number, extra: Partial<Idea> = {}): Idea {
  return { id, title: `Idea ${id}`, notes: "", created_at, used_at: null, script_id: null, folder_id: null, ...extra };
}

// Three fresh ideas (open group), one in the collapsed "older" group.
const IDEAS: Idea[] = [
  idea("a", now - 1000),
  idea("b", now - 2000),
  idea("c", now - 3000),
  idea("old", longAgo),
];

const convert = vi.fn(async (input: { ideaId: string }) => ({
  idea: { ...IDEAS.find((i) => i.id === input.ideaId)!, used_at: now },
  script: { id: `s-${input.ideaId}`, title: input.ideaId } as ScriptSummary,
}));
const setStatus = vi.fn(async () => undefined);

beforeAll(async () => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  const fake: Partial<TestStorage> = {
    listIdeas: async () => IDEAS.map((i) => ({ ...i })),
    listFolders: async () => [],
    listScripts: async () => [],
    globalSearch: async () => [],
    convertIdeaToScript: convert as unknown as TestStorage["convertIdeaToScript"],
    setScriptStatus: setStatus as unknown as TestStorage["setScriptStatus"],
  };
  setTestStorage(
    new Proxy(fake as TestStorage, {
      get(target, prop: string) {
        return (target as unknown as Record<string, unknown>)[prop] ?? (async () => null);
      },
    }),
  );
  ideasStore.refresh();
  stopIdeas = startIdeasStore();
  await navStore.openIdeas(null);
});

afterAll(() => {
  stopIdeas();
  setTestStorage(originalAdapter);
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

const row = (id: string) => document.getElementById(`idea-row-${id}`)!;
const checked = () =>
  [...document.querySelectorAll(".irow.is-sel")].map((r) => r.id.replace("idea-row-", "")).sort();
const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

describe("IdeasPage selection mode", () => {
  it("closes the open row and toggles instead of opening while selecting", async () => {
    render(() => <IdeasPage />);
    await settle();

    row("a").click();
    await settle();
    expect(row("a").classList.contains("ix")).toBe(true);

    button(t("select.enter")).click();
    await settle();
    expect(document.querySelector(".ix")).toBeNull();
    expect(row("a").classList.contains("irow")).toBe(true);

    row("b").click();
    await settle();
    expect(checked()).toEqual(["b"]);
    expect(document.querySelector(".ix")).toBeNull();

    // Enter does not open the cursor row while selecting.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(document.querySelector(".ix")).toBeNull();

    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector(".lib-selbar")).toBeNull();
    expect(document.querySelector(".ix")).toBeNull();
  });

  it("selects all / per group / by range and converts into scripts of a stage", async () => {
    render(() => <IdeasPage />);
    await settle();
    expect(document.querySelector(".lib-selbar")).toBeNull();

    button(t("select.enter")).click();
    await settle();
    expect(document.querySelector(".lib-selbar")).not.toBeNull();
    expect(checked()).toEqual([]);

    // "Select all" covers the open groups only (the "older" group is collapsed).
    const all = document.querySelector(".selhead [role=checkbox]") as HTMLButtonElement;
    all.click();
    await settle();
    expect(checked()).toEqual(["a", "b", "c"]);
    expect(all.getAttribute("aria-checked")).toBe("true");

    // A plain click toggles one row; the header turns "mixed".
    row("b").click();
    await settle();
    expect(checked()).toEqual(["a", "c"]);
    expect(all.getAttribute("aria-checked")).toBe("mixed");

    // Clearing, then a shift range from a to c.
    all.click();
    await settle();
    all.click();
    await settle();
    expect(checked()).toEqual([]);
    row("a").click();
    row("c").dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    await settle();
    expect(checked()).toEqual(["a", "b", "c"]);

    // Bulk convert into "ready".
    button(t("ideasPage.selection.convert"), document.querySelector(".lib-selbar")!).click();
    await settle();
    button(t("stage.ready"), document.querySelector(".menu")!).click();
    await settle();
    expect(convert.mock.calls.map((c) => c[0].ideaId).sort()).toEqual(["a", "b", "c"]);
    expect(setStatus).toHaveBeenCalledTimes(3);
    expect(setStatus).toHaveBeenCalledWith("s-a", "ready");

    // Esc leaves the selection mode.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(document.querySelector(".lib-selbar")).toBeNull();
  });
});
