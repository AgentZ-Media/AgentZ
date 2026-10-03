// Tests for the inline editing on the ideas page
// (components/Ideas/IdeasPage.tsx, variant A of
// docs/redesign/ideen-varianten.html): rows open in place instead of a
// side panel, only one row is open at a time, the open editor survives a
// store refresh, and the capture field expands for notes + folder.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import { ideasBus } from "../../../lib/ideasBus";
import type { Folder, Idea } from "../../../lib/types";
import { ideasStore, startIdeasStore } from "../../../stores/ideas";
import { navStore, startNavRuntime } from "../../../stores/nav";
import { IdeasPage } from "../IdeasPage";

const originalAdapter = getTestStorage();
let stopNav: () => void;
let stopIdeas: () => void;

const db = new Map<string, Idea>();
const created: Array<{ title: string; notes?: string; folderId?: string | null }> = [];
let seq = 0;

const folder = (id: string, name: string): Folder => ({
  id,
  name,
  created_at: 1,
  updated_at: 1,
  script_count: 0,
  length_min_sec: null,
  length_max_sec: null,
});
const FOLDERS: Folder[] = [folder("f1", "Office")];

function idea(id: string, created_at: number, extra: Partial<Idea> = {}): Idea {
  return { id, title: `Idea ${id}`, notes: "", created_at, used_at: null, script_id: null, folder_id: null, ...extra };
}

beforeAll(async () => {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  const fake: Partial<TestStorage> = {
    listIdeas: async () => [...db.values()].map((i) => ({ ...i })),
    listFolders: async () => FOLDERS,
    listScripts: async () => [],
    globalSearch: async () => [],
    createIdea: async (input) => {
      created.push(input);
      const next = idea(`n${++seq}`, Date.now(), {
        title: input.title,
        notes: input.notes ?? "",
        folder_id: input.folderId ?? null,
      });
      db.set(next.id, next);
      ideasBus.bump();
      return next;
    },
    updateIdea: async (input) => {
      const cur = db.get(input.id)!;
      const next = { ...cur, ...input };
      db.set(input.id, next);
      ideasBus.bump();
      return next;
    },
  };
  setTestStorage(
    new Proxy(fake as TestStorage, {
      get(target, prop: string) {
        return (target as unknown as Record<string, unknown>)[prop] ?? (async () => null);
      },
    }),
  );
  stopNav = startNavRuntime();
  stopIdeas = startIdeasStore();
  await navStore.openIdeas(null);
});

afterAll(() => {
  stopNav();
  stopIdeas();
  setTestStorage(originalAdapter);
});

beforeEach(async () => {
  db.clear();
  created.length = 0;
  const now = Date.now();
  db.set("a", idea("a", now - 3000, { notes: "Notes of A" }));
  db.set("b", idea("b", now - 2000));
  db.set("c", idea("c", now - 1000));
  ideasStore.refresh();
  await settle();
});

afterEach(() => {
  cleanup();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

const row = (id: string) => document.getElementById(`idea-row-${id}`);
const openRows = () => document.querySelectorAll(".ix");
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

function input(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

describe("IdeasPage inline editing", () => {
  it("has no side panel any more", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    expect(container.querySelector(".idet, aside")).toBeNull();
  });

  it("opens a clicked row in place and keeps only one row open", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    (row("a") as HTMLElement).click();
    await settle();
    expect(row("a")?.classList.contains("ix")).toBe(true);
    const notes = container.querySelector(".ix .ix-n") as HTMLTextAreaElement;
    expect(notes.value).toBe("Notes of A");
    expect(document.activeElement).toBe(notes);

    (row("b") as HTMLElement).click();
    await settle();
    expect(openRows()).toHaveLength(1);
    expect(row("b")?.classList.contains("ix")).toBe(true);
    expect(row("a")?.classList.contains("irow")).toBe(true);
  });

  it("closes the open row on Escape and when the selection moves", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    (row("c") as HTMLElement).click();
    await settle();
    key(container.querySelector(".ix .ix-n")!, "Escape");
    await settle();
    expect(openRows()).toHaveLength(0);
    const list = container.querySelector(".ilist") as HTMLElement;
    expect(document.activeElement).toBe(list);

    key(list, "Enter");
    await settle();
    expect(row("c")?.classList.contains("ix")).toBe(true);
    list.focus();
    key(list, "ArrowDown");
    await settle();
    expect(openRows()).toHaveLength(0);
    expect(row("b")?.classList.contains("is-primary")).toBe(true);
  });

  it("keeps the open editor mounted across a store refresh", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    (row("a") as HTMLElement).click();
    await settle();
    const notes = container.querySelector(".ix .ix-n") as HTMLTextAreaElement;
    input(notes, "Typing on");
    ideasStore.refresh();
    await settle();
    expect(container.querySelector(".ix .ix-n")).toBe(notes);
    expect(notes.value).toBe("Typing on");
  });

  it("keeps the open row listed while editing makes it stop matching the filter", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    const filter = container.querySelector(".i-filter input") as HTMLInputElement;
    input(filter, "Notes of");
    await settle();
    (row("a") as HTMLElement).click();
    await settle();
    const notes = container.querySelector(".ix .ix-n") as HTMLTextAreaElement;
    input(notes, "Something else");
    db.set("a", { ...db.get("a")!, notes: "Something else" });
    ideasStore.refresh();
    await settle();
    expect(container.querySelector(".ix .ix-n")).toBe(notes);
    // A new filter text drops it again.
    input(filter, "Notes of A");
    await settle();
    expect(openRows()).toHaveLength(0);
    expect(row("a")).toBeNull();
  });

  it("drops the capture notes when esc closes the expanded field", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    const title = container.querySelector(".i-cap-input") as HTMLInputElement;
    title.focus();
    input(title, "Later");
    key(title, "Tab");
    await settle();
    input(container.querySelector(".i-cap-notes") as HTMLTextAreaElement, "Gone");
    // esc in the notes goes back to the title, esc there closes.
    key(container.querySelector(".i-cap-notes")!, "Escape");
    await settle();
    expect(document.activeElement).toBe(title);
    expect(container.querySelector(".i-cap-notes")).not.toBeNull();
    key(title, "Escape");
    await settle();
    expect(container.querySelector(".i-cap-notes")).toBeNull();
    key(title, "Enter");
    await settle();
    expect(created).toEqual([{ title: "Later", notes: "", folderId: null }]);
  });

  it("captures a title with Enter and keeps focus in the field", async () => {
    const { container } = render(() => <IdeasPage />);
    await settle();
    const title = container.querySelector(".i-cap-input") as HTMLInputElement;
    title.focus();
    input(title, "Quick one");
    key(title, "Enter");
    await settle();
    expect(created).toEqual([{ title: "Quick one", notes: "", folderId: null }]);
    expect(title.value).toBe("");
    expect(document.activeElement).toBe(title);
  });

  it("expands the capture field with Tab for notes and the folder filter's folder", async () => {
    await navStore.openIdeas("f1");
    const { container } = render(() => <IdeasPage />);
    await settle();
    const title = container.querySelector(".i-cap-input") as HTMLInputElement;
    title.focus();
    input(title, "With notes");
    key(title, "Tab");
    await settle();
    const notes = container.querySelector(".i-cap-notes") as HTMLTextAreaElement;
    expect(notes).not.toBeNull();
    expect(document.activeElement).toBe(notes);
    input(notes, "Hook first");
    const remember = container.querySelector(".i-cap-act .btn.primary") as HTMLButtonElement;
    remember.click();
    await settle();
    expect(created).toEqual([{ title: "With notes", notes: "Hook first", folderId: "f1" }]);
    expect(container.querySelector(".i-cap-notes")).toBeNull();
    await navStore.openIdeas(null);
  });
});
