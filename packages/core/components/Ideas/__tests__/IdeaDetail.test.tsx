// Regression tests for the idea detail autosave
// (components/Ideas/parts/IdeaDetail.tsx): overlapping saves must diff
// against the last acknowledged write (not the lagging props) and flush
// must drain the newest draft.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { Show, createSignal } from "solid-js";
import { getStorageAdapter, setStorageAdapter, type StorageAdapter } from "../../../lib/storage";
import "../../../lib/api";
import { flushAll } from "../../../lib/saveFlush";
import type { Idea } from "../../../lib/types";
import { IdeaDetail } from "../parts/IdeaDetail";

const originalAdapter = getStorageAdapter();
const updates: Array<{ id: string; title?: string; notes?: string }> = [];
const gates: Array<() => void> = [];

beforeAll(() => {
  setStorageAdapter(
    new Proxy({} as StorageAdapter, {
      get(_, prop: string) {
        if (prop === "updateIdea") {
          return (input: { id: string; title?: string; notes?: string }) =>
            new Promise((resolve) => {
              updates.push(input);
              gates.push(() => resolve({ ...IDEA, ...input }));
            });
        }
        if (prop === "globalSearch") return async () => [];
        return vi.fn().mockResolvedValue(undefined);
      },
    }),
  );
});

afterAll(() => {
  setStorageAdapter(originalAdapter);
});

afterEach(() => {
  cleanup();
  updates.length = 0;
  gates.length = 0;
});

const IDEA: Idea = {
  id: "i1",
  title: "Title",
  notes: "O",
  created_at: 1,
  used_at: null,
  script_id: null,
  folder_id: null,
};

const tick = () => new Promise((r) => setTimeout(r, 0));

function type(el: HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

function renderDetail(shown?: () => boolean) {
  const view = () => (
    <IdeaDetail
      ideaId="i1"
      // Props never refresh here - stale like during an in-flight save.
      ideas={[IDEA]}
      folders={[]}
      scripts={new Map()}
      now={2}
      onReady={() => {}}
      onConvert={() => {}}
      onDelete={() => {}}
      onMove={() => {}}
      onOpenScript={() => {}}
      onSelectIdea={() => {}}
      onLeave={() => {}}
    />
  );
  const { container } = render(() => (shown ? <Show when={shown()}>{view()}</Show> : view()));
  const notes = container.querySelector("textarea.idet-n") as HTMLTextAreaElement;
  const title = container.querySelector("textarea.idet-t") as HTMLTextAreaElement;
  return { notes, title };
}

describe("IdeaDetail autosave", () => {
  it("writes a revert to the original notes made while a save is in flight", async () => {
    const { notes } = renderDetail();
    notes.focus();
    type(notes, "A");
    // Blur starts the save of A.
    notes.blur();
    await tick();
    expect(updates).toEqual([{ id: "i1", notes: "A" }]);

    // Restore O and blur again before A is acknowledged.
    notes.focus();
    type(notes, "O");
    notes.blur();
    await tick();
    expect(updates).toHaveLength(1);

    gates.shift()?.();
    await tick();
    expect(updates).toEqual([
      { id: "i1", notes: "A" },
      { id: "i1", notes: "O" },
    ]);
    gates.shift()?.();
    await flushAll(60_000);
  });

  it("flushAll drains the latest draft and waits for it", async () => {
    const { title } = renderDetail();
    type(title, "New title");
    let done = false;
    const p = flushAll(60_000).then(() => {
      done = true;
    });
    await tick();
    expect(updates).toEqual([{ id: "i1", title: "New title" }]);
    expect(done).toBe(false);
    gates.shift()?.();
    await p;
    expect(done).toBe(true);
  });

  it("writes pending drafts on unmount (idea switch / page leave)", async () => {
    const [shown, setShown] = createSignal(true);
    const { notes } = renderDetail(shown);
    type(notes, "Typed right before switching");
    setShown(false);
    await tick();
    expect(updates).toEqual([{ id: "i1", notes: "Typed right before switching" }]);
    gates.shift()?.();
    await flushAll(60_000);
  });
});
