// Regression tests for revealing an idea on the ideas page
// (components/Ideas/IdeasPage.tsx): a palette result or a "similar idea"
// link must select (and open) the idea even when it sits in a collapsed group, beyond
// the loaded page (50 rows), behind the text filter, "show used" or a folder chip.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "@solidjs/testing-library";
import { getStorageAdapter, setStorageAdapter, type ScriptzApiStorage } from "../../../lib/storage";
import "../../../lib/api";
import type { Folder, Idea } from "../../../lib/types";
import { ideasStore, startIdeasStore } from "../../../stores/ideas";
import { navStore } from "../../../stores/nav";
import { uiStore } from "../../../stores/ui";
import { IdeasPage } from "../IdeasPage";

const originalAdapter = getStorageAdapter();
let stopIdeas: () => void;

const now = new Date();
const lastMonth = (i: number) => new Date(now.getFullYear(), now.getMonth() - 1, 10, 12, i).getTime();
const longAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1).getTime();

function idea(id: string, created_at: number, extra: Partial<Idea> = {}): Idea {
  return { id, title: `Idea ${id}`, notes: "", created_at, used_at: null, script_id: null, folder_id: null, ...extra };
}

// Sixty ideas in last month's group (page size 50: the oldest ones, m0
// among them, sit behind "load more" in the newest-first sort), one in the
// collapsed "older" group,
// one converted idea and two in folders.
const IDEAS: Idea[] = [
  ...Array.from({ length: 60 }, (_, i) => idea(`m${i}`, lastMonth(i))),
  idea("old", longAgo),
  idea("used", lastMonth(30), { used_at: lastMonth(31), title: "Converted one" }),
  idea("inF", lastMonth(40), { folder_id: "f1", title: "Folder one" }),
  idea("inG", lastMonth(41), { folder_id: "f2", title: "Other folder" }),
];
const folder = (id: string, name: string): Folder => ({
  id,
  name,
  created_at: 1,
  updated_at: 1,
  script_count: 0,
  length_min_sec: null,
  length_max_sec: null,
});
const FOLDERS: Folder[] = [folder("f1", "One"), folder("f2", "Two")];

beforeAll(async () => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  const fake: Partial<ScriptzApiStorage> = {
    listIdeas: async () => IDEAS.map((i) => ({ ...i })),
    listFolders: async () => FOLDERS,
    listScripts: async () => [],
    globalSearch: async () => [],
  };
  setStorageAdapter(
    new Proxy(fake as ScriptzApiStorage, {
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
  setStorageAdapter(originalAdapter);
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

const row = (id: string) => document.getElementById(`idea-row-${id}`);
const isSelected = (id: string) => !!row(id)?.classList.contains("is-primary");

describe("IdeasPage reveal", () => {
  it("opens collapsed groups, loads further pages and clears hiding filters", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    expect(row("m59")).not.toBeNull();

    // Beyond the first page of 50 rows.
    expect(row("m0")).toBeNull();
    uiStore.revealIdea("m0");
    await settle();
    expect(isSelected("m0")).toBe(true);
    // ...and opens it in place.
    expect(row("m0")?.classList.contains("ix")).toBe(true);

    // In the collapsed "older" group.
    expect(row("old")).toBeNull();
    uiStore.revealIdea("old");
    await settle();
    expect(isSelected("old")).toBe(true);

    // Converted idea while "show used" is off.
    expect(row("used")).toBeNull();
    uiStore.revealIdea("used");
    await settle();
    expect(isSelected("used")).toBe(true);

    // Hidden by the text filter.
    const filter = container.querySelector(".i-filter input") as HTMLInputElement;
    filter.value = "Folder one";
    filter.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settle();
    expect(row("m5")).toBeNull();
    uiStore.revealIdea("m5");
    await settle();
    expect(filter.value).toBe("");
    expect(isSelected("m5")).toBe(true);

    // Hidden by a folder chip: the filter falls back to "all".
    await navStore.openIdeas("f1");
    await settle();
    expect(row("inG")).toBeNull();
    uiStore.revealIdea("inG");
    await settle();
    const r = navStore.route();
    expect(r.kind === "ideas" ? r.folderId ?? null : "x").toBeNull();
    expect(isSelected("inG")).toBe(true);
  });
});
