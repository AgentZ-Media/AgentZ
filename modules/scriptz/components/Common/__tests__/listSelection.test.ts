import { describe, expect, it } from "vitest";
import { createEffect, createRoot, createSignal } from "solid-js";
import { isMac } from "@agentz/kit/platform";
import { createListSelection, isSelectAllKey } from "../listSelection";

function setup(initial: string[] = ["a", "b", "c"]) {
  return createRoot((dispose) => {
    const [ids, setIds] = createSignal<string[]>(initial);
    const sel = createListSelection({ selectableIds: ids });
    return { sel, setIds, dispose };
  });
}

const sorted = (s: Set<string>) => [...s].sort();

describe("createListSelection", () => {
  it("starts outside the selection mode with nothing checked", () => {
    const { sel, dispose } = setup();
    expect(sel.selectMode()).toBe(false);
    expect(sel.selected().size).toBe(0);
    expect(sel.allState()).toBe("none");
    dispose();
  });

  it("enter turns the mode on with exactly the given ids", () => {
    const { sel, dispose } = setup();
    sel.toggle(["x"]);
    sel.enter(["a"]);
    expect(sel.selectMode()).toBe(true);
    expect(sorted(sel.selected())).toEqual(["a"]);
    sel.enter();
    expect(sel.selected().size).toBe(0);
    dispose();
  });

  it("selectAll checks every selectable id and turns the mode on", () => {
    const { sel, dispose } = setup();
    sel.selectAll();
    expect(sel.selectMode()).toBe(true);
    expect(sorted(sel.selected())).toEqual(["a", "b", "c"]);
    expect(sel.allState()).toBe("all");
    dispose();
  });

  it("reads the selectable ids lazily", () => {
    const { sel, setIds, dispose } = setup([]);
    setIds(["d", "e"]);
    sel.selectAll();
    expect(sorted(sel.selected())).toEqual(["d", "e"]);
    dispose();
  });

  it("toggleAll clears a full selection and completes a partial one", () => {
    const { sel, dispose } = setup();
    sel.enter(["a"]);
    expect(sel.allState()).toBe("some");
    sel.toggleAll();
    expect(sel.allState()).toBe("all");
    sel.toggleAll();
    expect(sel.allState()).toBe("none");
    expect(sel.selectMode()).toBe(true);
    dispose();
  });

  it("toggle and groupState work on a batch of ids", () => {
    const { sel, dispose } = setup();
    sel.enter(["a"]);
    expect(sel.groupState(["a", "b"])).toBe("some");
    sel.toggle(["a", "b"]);
    expect(sel.groupState(["a", "b"])).toBe("all");
    sel.toggle(["a", "b"]);
    expect(sel.groupState(["a", "b"])).toBe("none");
    dispose();
  });

  it("add checks a range without unchecking anything", () => {
    const { sel, dispose } = setup();
    sel.enter(["a"]);
    sel.add(["a", "b"]);
    expect(sorted(sel.selected())).toEqual(["a", "b"]);
    dispose();
  });

  it("clear keeps the mode, exit leaves it", () => {
    const { sel, dispose } = setup();
    sel.selectAll();
    sel.clear();
    expect(sel.selectMode()).toBe(true);
    expect(sel.selected().size).toBe(0);
    sel.selectAll();
    sel.exit();
    expect(sel.selectMode()).toBe(false);
    expect(sel.selected().size).toBe(0);
    dispose();
  });

  it("retain drops ids and only updates when something drops", () => {
    const { sel, dispose } = setup();
    sel.selectAll();
    let runs = 0;
    const stop = createRoot((d) => {
      createEffect(() => {
        sel.selected();
        runs++;
      });
      return d;
    });
    const before = runs;
    sel.retain(() => true);
    expect(runs).toBe(before);
    sel.retain((id) => id !== "b");
    expect(sorted(sel.selected())).toEqual(["a", "c"]);
    expect(runs).toBe(before + 1);
    stop();
    dispose();
  });
});

describe("isSelectAllKey", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("accepts the platform modifier with A only", () => {
    const mod = isMac() ? { metaKey: true } : { ctrlKey: true };
    expect(isSelectAllKey(key({ key: "a", ...mod }))).toBe(true);
    expect(isSelectAllKey(key({ key: "A", ...mod }))).toBe(true);
    expect(isSelectAllKey(key({ key: "a", shiftKey: true, ...mod }))).toBe(false);
    expect(isSelectAllKey(key({ key: "a", altKey: true, ...mod }))).toBe(false);
    expect(isSelectAllKey(key({ key: "b", ...mod }))).toBe(false);
    expect(isSelectAllKey(key({ key: "a" }))).toBe(false);
  });
});
