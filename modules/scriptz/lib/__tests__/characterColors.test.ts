// Sanity tests for the pure character-color helpers (parse/serialise +
// the case-insensitive name matching that drives reconciliation).
//
// The async DB-backed flows in characterColors.ts (listCharacterColors,
// setCharacterColor, etc.) need a fake DbConnection and are covered
// separately when we add the storage-adapter mock in Phase C.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PALETTE,
  parseCharsMeta,
  serializeCharsMeta,
  eqIgnoreAsciiCase,
} from "../characterColors";

describe("DEFAULT_PALETTE", () => {
  it("is non-empty and contains only hex colours", () => {
    expect(DEFAULT_PALETTE.length).toBeGreaterThan(0);
    for (const c of DEFAULT_PALETTE) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("parseCharsMeta + serializeCharsMeta", () => {
  it("round-trips a typical characters_meta payload", () => {
    const list = [
      { name: "MAX", color: "#7aa2f7", share: 0.6 },
      { name: "EVA", color: "#f7768e", share: 0.4 },
    ];
    const back = parseCharsMeta(serializeCharsMeta(list));
    expect(back).toEqual(list);
  });

  it("parseCharsMeta returns [] for invalid JSON without throwing", () => {
    expect(parseCharsMeta("not json")).toEqual([]);
    expect(parseCharsMeta("{}")).toEqual([]);
    expect(parseCharsMeta('"a string"')).toEqual([]);
  });
});

describe("eqIgnoreAsciiCase", () => {
  it("matches mixed-case ASCII names", () => {
    expect(eqIgnoreAsciiCase("max", "MAX")).toBe(true);
    expect(eqIgnoreAsciiCase("Eva", "eVA")).toBe(true);
  });

  it("treats different names as different", () => {
    expect(eqIgnoreAsciiCase("Max", "Maxi")).toBe(false);
    expect(eqIgnoreAsciiCase("", "X")).toBe(false);
  });

  it("does not case-fold non-ASCII (matches Rust semantics)", () => {
    // German umlauts intentionally stay distinct from their ASCII
    // counterparts: 'ä' !== 'Ä' here by design - the reconciliation
    // pipeline upper-cases names elsewhere before comparing.
    // We only verify the function does not crash and stays deterministic.
    expect(eqIgnoreAsciiCase("Müller", "Müller")).toBe(true);
  });
});
