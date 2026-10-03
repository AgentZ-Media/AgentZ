// Tests for the target-range field glue (components/Settings/rangeInput.ts).

import { describe, expect, it } from "vitest";
import { boundText, parseRangeInput } from "../rangeInput";

describe("parseRangeInput", () => {
  it("parses both bounds", () => {
    expect(parseRangeInput("0:45", "1:05")).toEqual({ ok: true, minSec: 45, maxSec: 65 });
  });
  it("accepts plain seconds", () => {
    expect(parseRangeInput("30", "90")).toEqual({ ok: true, minSec: 30, maxSec: 90 });
  });
  it("treats empty fields as unset", () => {
    expect(parseRangeInput("", "1:00")).toEqual({ ok: true, minSec: null, maxSec: 60 });
    expect(parseRangeInput(" ", "")).toEqual({ ok: true, minSec: null, maxSec: null });
    expect(parseRangeInput("0:30", "")).toEqual({ ok: true, minSec: 30, maxSec: null });
  });
  it("reports the field with a bad format", () => {
    expect(parseRangeInput("abc", "1:00")).toEqual({ ok: false, field: "min", reason: "format" });
    expect(parseRangeInput("0:30", "1:75")).toEqual({ ok: false, field: "max", reason: "format" });
  });
  it("rejects min >= max", () => {
    expect(parseRangeInput("1:00", "1:00")).toEqual({ ok: false, field: "max", reason: "order" });
    expect(parseRangeInput("1:30", "0:45")).toEqual({ ok: false, field: "max", reason: "order" });
  });
});

describe("boundText", () => {
  it("formats seconds as m:ss and null as empty", () => {
    expect(boundText(65)).toBe("1:05");
    expect(boundText(0)).toBe("0:00");
    expect(boundText(null)).toBe("");
  });
});
