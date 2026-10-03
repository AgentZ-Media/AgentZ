import { describe, expect, it } from "vitest";
import { checkState, rangeBetween, toggleIds, withIds } from "../selection";

describe("selection helpers", () => {
  it("checkState reports none / some / all", () => {
    const sel = new Set(["a", "b"]);
    expect(checkState([], sel)).toBe("none");
    expect(checkState(["c"], sel)).toBe("none");
    expect(checkState(["a", "c"], sel)).toBe("some");
    expect(checkState(["a", "b"], sel)).toBe("all");
  });

  it("withIds adds and removes without touching the input", () => {
    const sel = new Set(["a"]);
    expect([...withIds(sel, ["b", "c"], true)]).toEqual(["a", "b", "c"]);
    expect([...withIds(sel, ["a"], false)]).toEqual([]);
    expect([...sel]).toEqual(["a"]);
  });

  it("toggleIds selects a partial group fully and clears a full one", () => {
    expect([...toggleIds(new Set(["a"]), ["a", "b"])].sort()).toEqual(["a", "b"]);
    expect([...toggleIds(new Set(["a", "b", "x"]), ["a", "b"])]).toEqual(["x"]);
  });

  it("rangeBetween works in both directions", () => {
    const order = ["a", "b", "c", "d"];
    expect(rangeBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(rangeBetween(order, "c", "c")).toEqual(["c"]);
    expect(rangeBetween(order, "a", "z")).toBeNull();
  });
});
