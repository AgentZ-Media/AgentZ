import { describe, expect, it } from "vitest";
import { keepUnchanged, sameData } from "../reconcile";

describe("sameData", () => {
  it("compares plain records deeply", () => {
    expect(sameData({ a: 1, b: [{ c: "x" }] }, { a: 1, b: [{ c: "x" }] })).toBe(true);
    expect(sameData({ a: 1, b: [{ c: "x" }] }, { a: 1, b: [{ c: "y" }] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(sameData(null, {})).toBe(false);
    expect(sameData(Number.NaN, Number.NaN)).toBe(true);
  });
});

describe("keepUnchanged", () => {
  const row = (id: string, title: string) => ({ id, title, tags: [{ name: "x" }] });

  it("returns the previous array when nothing changed", () => {
    const prev = [row("a", "A"), row("b", "B")];
    expect(keepUnchanged(prev, [row("a", "A"), row("b", "B")])).toBe(prev);
  });

  it("keeps unchanged records and takes changed or new ones", () => {
    const prev = [row("a", "A"), row("b", "B")];
    const changed = row("b", "B2");
    const added = row("c", "C");
    const out = keepUnchanged(prev, [added, row("a", "A"), changed]);
    expect(out).not.toBe(prev);
    expect(out[0]).toBe(added);
    expect(out[1]).toBe(prev[0]);
    expect(out[2]).toBe(changed);
  });

  it("follows a new order without copying records", () => {
    const prev = [row("a", "A"), row("b", "B")];
    const out = keepUnchanged(prev, [row("b", "B"), row("a", "A")]);
    expect(out).toEqual([prev[1], prev[0]]);
    expect(out[0]).toBe(prev[1]);
  });

  it("drops removed records and accepts an empty start", () => {
    const prev = [row("a", "A"), row("b", "B")];
    const next = [row("a", "A")];
    expect(keepUnchanged(prev, next)).toEqual([prev[0]]);
    expect(keepUnchanged(undefined, next)).toBe(next);
  });
});
