// Regression tests for the editor's save lifecycle
// (components/Editor/persistence.ts): serialized saves, undo during an
// in-flight save, and flushAll awaiting the whole queue.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexicalEditor } from "lexical";
import { getTestStorage, setTestStorage, type TestStorage } from "../../../test/storage";
import "../../../lib/api";
import { flushAll } from "@agentz/kit/lib";
import { createPersistence } from "../persistence";

const originalAdapter = getTestStorage();

function doc(text: string): string {
  return JSON.stringify({ root: { children: [{ type: "scriptz-action", children: [{ type: "text", text }] }] } });
}

/** Just enough of a LexicalEditor for persistence.ts: a mutable state
 *  whose JSON is the current doc. */
function fakeEditor(initial: string) {
  let current = JSON.parse(initial) as unknown;
  const state = {
    read: (fn: () => void) => fn(),
    toJSON: () => current,
  };
  const editor = { getEditorState: () => state } as unknown as LexicalEditor;
  return {
    editor,
    set(json: string) {
      current = JSON.parse(json);
    },
  };
}

function controllableAdapter() {
  const writes: string[] = [];
  const gates: Array<() => void> = [];
  let stored: string | null = null;
  const updateScript = vi.fn(
    (input: { id: string; contentJson?: string }) =>
      new Promise((resolve) => {
        writes.push(input.contentJson ?? "");
        gates.push(() => {
          stored = input.contentJson ?? null;
          resolve({ id: input.id, characters: [] });
        });
      }),
  );
  const adapter = new Proxy({} as TestStorage, {
    get(_, prop: string) {
      if (prop === "updateScript") return updateScript;
      return vi.fn().mockResolvedValue(undefined);
    },
  });
  return {
    adapter,
    writes,
    stored: () => stored,
    release() {
      gates.shift()?.();
    },
    open: () => gates.length,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setTestStorage(originalAdapter);
});

function setup(initial: string) {
  const store = controllableAdapter();
  setTestStorage(store.adapter);
  const ed = fakeEditor(initial);
  const handle = createPersistence({
    editor: ed.editor,
    scriptId: "s1",
    initialContentJson: initial,
    mergeAfterSave: () => {},
    knownColors: new Map(),
  });
  return { store, ed, handle };
}

describe("createPersistence", () => {
  it("retries the final live draft after teardown even when Lexical has cleared its document", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateScript = vi.fn().mockRejectedValue(new Error("offline"));
    setTestStorage({ updateScript } as unknown as TestStorage);
    const original = doc("stored");
    const finalDraft = doc("last live draft");
    const ed = fakeEditor(original);
    const handle = createPersistence({
      editor: ed.editor, scriptId: "teardown", initialContentJson: original,
      mergeAfterSave: () => {}, knownColors: new Map(),
    });
    ed.set(finalDraft);
    handle.scheduleSave();
    handle.teardown();
    ed.set(doc(""));
    expect(await flushAll()).toEqual({ ok: false, failed: ["editor:teardown"] });
    updateScript.mockResolvedValue({ id: "teardown", characters: [] });
    expect(await flushAll()).toEqual({ ok: true, failed: [] });
    expect(updateScript.mock.calls.at(-1)?.[0].contentJson).toBe(finalDraft);
    const calls = updateScript.mock.calls.length;
    await flushAll();
    expect(updateScript).toHaveBeenCalledTimes(calls);
    errorLog.mockRestore();
  });

  it("doesn't lose an undo back to the stored state while a newer save is in flight", async () => {
    const A = doc("alpha");
    const B = doc("alpha beta");
    const { store, ed, handle } = setup(A);

    ed.set(B);
    handle.scheduleSave();
    await vi.advanceTimersByTimeAsync(250);
    expect(store.writes).toEqual([B]);

    // Undo to A before B is acknowledged.
    ed.set(A);
    handle.scheduleSave();
    await vi.advanceTimersByTimeAsync(250);
    // Still serialized: A waits for B.
    expect(store.open()).toBe(1);

    store.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([B, A]);
    store.release();
    await handle.flush();
    expect(store.stored()).toBe(A);
    handle.teardown();
  });

  it("skips saving the unchanged loaded state", async () => {
    const A = doc("alpha");
    const { store, handle } = setup(A);
    handle.scheduleSave();
    await vi.advanceTimersByTimeAsync(250);
    await handle.flush();
    expect(store.writes).toEqual([]);
    handle.teardown();
  });

  it("flushAll awaits buffered AND in-flight saves", async () => {
    const A = doc("alpha");
    const B = doc("beta");
    const C = doc("gamma");
    const { store, ed, handle } = setup(A);

    ed.set(B);
    handle.scheduleSave();
    await vi.advanceTimersByTimeAsync(250); // B in flight
    ed.set(C);
    handle.scheduleSave(); // C still debounced

    let done = false;
    const p = flushAll(60_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    store.release(); // B
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([B, C]);
    expect(done).toBe(false);
    store.release(); // C
    await p;
    expect(store.stored()).toBe(C);
    handle.teardown();
  });

  it("keeps the flusher registered after teardown until the last save landed", async () => {
    const A = doc("alpha");
    const B = doc("beta");
    const { store, ed, handle } = setup(A);
    ed.set(B);
    handle.scheduleSave();
    handle.teardown();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([B]);

    let done = false;
    const p = flushAll(60_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    store.release();
    await p;
    expect(store.stored()).toBe(B);
  });

  it("refuses to overwrite content with an empty state on teardown", async () => {
    const A = doc("alpha");
    const empty = JSON.stringify({ root: { children: [] } });
    const { store, ed, handle } = setup(A);
    ed.set(empty);
    handle.scheduleSave();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    handle.teardown();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.writes).toEqual([]);
    warn.mockRestore();
  });
});
