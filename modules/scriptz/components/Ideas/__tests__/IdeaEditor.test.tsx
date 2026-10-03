// Regression tests for the inline idea editor autosave
// (components/Ideas/parts/IdeaEditor.tsx + ideaDrafts.ts): overlapping
// saves must diff against the last acknowledged write (not the lagging
// props), flush must drain the newest draft, and collapsing / switching
// ideas while a save is in flight must never resurrect stale cached notes.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { For, createSignal } from "solid-js";
import { getStorageAdapter, setStorageAdapter, type StorageAdapter } from "../../../lib/storage";
import "../../../lib/api";
import { ideasBus } from "../../../lib/ideasBus";
import { flushAll } from "../../../lib/saveFlush";
import type { Idea } from "../../../lib/types";
import { ideasStore } from "../../../stores/ideas";
import { IdeaEditor } from "../parts/IdeaEditor";
import { ideaDraftCount } from "../parts/ideaDrafts";

const originalAdapter = getStorageAdapter();

// In-memory storage: updateIdea waits for a gate (slow disk), applies the
// patch and bumps the ideas bus like the real adapters; listIdeas can be
// held back too (slow refetch).
const db = new Map<string, Idea>();
const updates: Array<{ id: string; title?: string; notes?: string }> = [];
const gates: Array<() => void> = [];
let holdList = false;
const listGates: Array<() => void> = [];

beforeAll(() => {
  const fake: Partial<StorageAdapter> = {
    updateIdea: (input) =>
      new Promise<Idea>((resolve) => {
        updates.push(input);
        gates.push(() => {
          const cur = db.get(input.id)!;
          const next = {
            ...cur,
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
          };
          db.set(input.id, next);
          ideasBus.bump();
          resolve(next);
        });
      }),
    listIdeas: async () => {
      if (holdList) await new Promise<void>((r) => listGates.push(r));
      return [...db.values()].map((i) => ({ ...i }));
    },
    globalSearch: async () => [],
  };
  setStorageAdapter(
    new Proxy(fake as StorageAdapter, {
      get(target, prop: string) {
        return (target as unknown as Record<string, unknown>)[prop] ?? (async () => undefined);
      },
    }),
  );
});

afterAll(() => {
  setStorageAdapter(originalAdapter);
});

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Releases every held write / refetch until all drafts are persisted. */
async function settle() {
  holdList = false;
  let done = false;
  const flushed = flushAll(60_000).then(() => {
    done = true;
  });
  while (!done) {
    while (listGates.length) listGates.shift()?.();
    while (gates.length) gates.shift()?.();
    await tick();
  }
  await flushed;
  await tick();
}

beforeEach(async () => {
  db.clear();
  db.set("a", { id: "a", title: "Idea A", notes: "O", created_at: 1, used_at: null, script_id: null, folder_id: null });
  db.set("b", { id: "b", title: "Idea B", notes: "", created_at: 2, used_at: null, script_id: null, folder_id: null });
  ideasStore.refresh();
  await tick();
});

afterEach(async () => {
  cleanup();
  await settle();
  updates.length = 0;
});

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.focus();
  el.value = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

/** Mirrors the ideas page: one open editor keyed by the open row's id, fed
 *  from the shared ideas store. */
function renderPanel(initial: string | null) {
  const [selected, setSelected] = createSignal<string | null>(initial);
  const { container } = render(() => (
    <For each={selected() ? [selected()!] : []}>
      {(id) => (
        <IdeaEditor
          ideaId={id}
          ideas={ideasStore.ideas() ?? []}
          folders={[]}
          scripts={new Map()}
          now={2}
          onReady={() => {}}
          onConvert={() => {}}
          onDelete={() => {}}
          onMove={() => {}}
          onOpenScript={() => {}}
          onSelectIdea={() => {}}
          onCollapse={() => {}}
        />
      )}
    </For>
  ));
  return {
    select: setSelected,
    notes: () => container.querySelector("textarea.ix-n") as HTMLTextAreaElement,
    title: () => container.querySelector("input.ix-t") as HTMLInputElement,
  };
}

describe("IdeaEditor autosave", () => {
  it("writes a revert to the original notes made while a save is in flight", async () => {
    const p = renderPanel("a");
    const notes = p.notes();
    notes.focus();
    type(notes, "A");
    // Blur starts the save of A.
    notes.blur();
    await tick();
    expect(updates).toEqual([{ id: "a", notes: "A" }]);

    // Restore O and blur again before A is acknowledged.
    notes.focus();
    type(notes, "O");
    notes.blur();
    await tick();
    expect(updates).toHaveLength(1);

    gates.shift()?.();
    await tick();
    expect(updates).toEqual([
      { id: "a", notes: "A" },
      { id: "a", notes: "O" },
    ]);
    await settle();
    expect(db.get("a")?.notes).toBe("O");
  });

  it("flushAll drains the latest draft and waits for it", async () => {
    const p = renderPanel("a");
    type(p.title(), "New title");
    let done = false;
    const flushed = flushAll(60_000).then(() => {
      done = true;
    });
    await tick();
    expect(updates).toEqual([{ id: "a", title: "New title" }]);
    expect(done).toBe(false);
    gates.shift()?.();
    await flushed;
    expect(done).toBe(true);
  });

  it("writes pending drafts on unmount (collapse / idea switch / page leave)", async () => {
    const p = renderPanel("a");
    type(p.notes(), "Typed right before switching");
    p.select(null);
    await tick();
    expect(updates).toEqual([{ id: "a", notes: "Typed right before switching" }]);
    await settle();
    expect(db.get("a")?.notes).toBe("Typed right before switching");
  });

  it("switching A -> B -> A before the save landed keeps the pending notes", async () => {
    const p = renderPanel("a");
    type(p.notes(), "O plus");
    p.select("b"); // A unmounts, its save starts (held)
    await tick();
    expect(updates).toEqual([{ id: "a", notes: "O plus" }]);

    // Back to A while the save is still in flight: the cached list says "O".
    p.select("a");
    await tick();
    expect(ideasStore.ideas()?.find((i) => i.id === "a")?.notes).toBe("O");
    expect(p.notes().value).toBe("O plus");

    // The save lands, the refetch follows; then the writer keeps typing.
    gates.shift()?.();
    await tick();
    await tick();
    expect(p.notes().value).toBe("O plus");
    type(p.notes(), "O plus more");
    p.notes().blur();
    await tick();
    expect(updates).toEqual([
      { id: "a", notes: "O plus" },
      { id: "a", notes: "O plus more" },
    ]);
    await settle();
    expect(db.get("a")?.notes).toBe("O plus more");
  });

  it("remounting after the save but before the refetch shows the saved notes", async () => {
    const p = renderPanel("a");
    type(p.notes(), "Saved");
    holdList = true; // the refetch after the save is slow
    p.select("b");
    await tick();
    gates.shift()?.(); // save acknowledged, refetch pending
    await tick();
    expect(ideasStore.ideas()?.find((i) => i.id === "a")?.notes).toBe("O");

    p.select("a");
    await tick();
    expect(p.notes().value).toBe("Saved");
    type(p.notes(), "Saved and more");
    p.notes().blur();
    await tick();
    expect(updates.at(-1)).toEqual({ id: "a", notes: "Saved and more" });
    await settle();
    expect(db.get("a")?.notes).toBe("Saved and more");
  });

  it("follows a change made elsewhere while the field is clean", async () => {
    const p = renderPanel("a");
    expect(p.notes().value).toBe("O");
    db.set("a", { ...db.get("a")!, notes: "From elsewhere" });
    ideasStore.refresh();
    await tick();
    expect(p.notes().value).toBe("From elsewhere");
    // ...and diffs later edits against it.
    type(p.notes(), "From elsewhere!");
    p.notes().blur();
    await tick();
    expect(updates).toEqual([{ id: "a", notes: "From elsewhere!" }]);
  });

  it("drops the per-idea drafts once everything is saved and in sync", async () => {
    const p = renderPanel("a");
    type(p.notes(), "Done");
    p.select("b");
    p.select(null);
    await settle();
    expect(ideaDraftCount()).toBe(0);
  });
});
