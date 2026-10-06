// Tests for the stable folder colour (components/Common/folderColor.ts).

import { describe, expect, it } from "vitest";
import { folderColor } from "../folderColor";
import { CHARACTER_PALETTE } from "../../../lib/colors";

describe("folderColor", () => {
  it("is stable for the same id", () => {
    const id = "6f1c2a4e-1b2d-4c3e-9f00-112233445566";
    expect(folderColor(id)).toBe(folderColor(id));
  });

  it("always returns a palette colour", () => {
    for (let i = 0; i < 200; i++) {
      expect(CHARACTER_PALETTE).toContain(folderColor(`folder-${i}`));
    }
  });

  it("spreads different ids over the palette", () => {
    const used = new Set<string>();
    for (let i = 0; i < 100; i++) used.add(folderColor(crypto.randomUUID()));
    expect(used.size).toBeGreaterThan(5);
  });

  it("handles the empty id", () => {
    expect(CHARACTER_PALETTE).toContain(folderColor(""));
  });
});
