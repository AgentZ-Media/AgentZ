// Tests for the counter roll (components/Common/motion.tsx).

import { describe, expect, it } from "vitest";
import { rollDigits } from "../motion";

describe("rollDigits", () => {
  it("marks only the places that changed", () => {
    expect(rollDigits("129", "128")).toEqual([
      { now: "1", old: null },
      { now: "2", old: null },
      { now: "9", old: "8" },
    ]);
  });

  it("aligns numbers of different length on the right", () => {
    expect(rollDigits("10", "9")).toEqual([
      { now: "1", old: " " },
      { now: "0", old: "9" },
    ]);
    expect(rollDigits("9", "10")).toEqual([
      { now: " ", old: "1" },
      { now: "9", old: "0" },
    ]);
  });

  it("does not roll without a previous value", () => {
    expect(rollDigits("42", null)).toEqual([
      { now: "4", old: null },
      { now: "2", old: null },
    ]);
  });
});
