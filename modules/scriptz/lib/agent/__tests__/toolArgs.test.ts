import { describe, expect, it } from "vitest";
import { fail, isObj, obj, ok } from "../toolArgs";

describe("tool argument helpers", () => {
  it("accepts only plain objects", () => {
    const value = { a: 1 };
    expect(isObj(value)).toBe(true);
    expect(obj(value)).toBe(value);
    for (const v of [null, undefined, [], "x", 3, true]) {
      expect(isObj(v)).toBe(false);
      expect(obj(v)).toEqual({});
    }
  });

  it("builds ok results, passing strings through and serializing the rest", () => {
    expect(ok("done")).toEqual({ ok: true, output: "done" });
    expect(ok({ id: "s1" })).toEqual({ ok: true, output: '{"id":"s1"}' });
  });

  it("builds fail results with an error payload", () => {
    expect(fail("unknown folder: x")).toEqual({ ok: false, output: '{"error":"unknown folder: x"}' });
  });
});
