// Tests for "Ähnliche Stücke" (components/Ideas/similar.ts).

import { describe, expect, it } from "vitest";
import { rankScriptHits, similarIdeas, similarQueryTerms } from "../similar";
import type { SearchHit } from "../../../lib/types";

const hit = (id: string, title = id): SearchHit => ({ kind: "script", id, title, snippet: "", meta: {} });

describe("similarQueryTerms", () => {
  it("drops stopwords and numbers, longest words first", () => {
    expect(similarQueryTerms("Timo geht um 13 Uhr statt um 17 Uhr")).toEqual(["timo", "geht"]);
    expect(similarQueryTerms("Eine Schweigeminute für Opfer-Chefs")).toEqual([
      "schweigeminute",
      "opfer", // ties keep title order
      "chefs",
    ]);
  });
  it("caps the number of terms", () => {
    expect(similarQueryTerms("Homeoffice aber Laptop im Büro vergessen", 2)).toEqual(["homeoffice", "vergessen"]);
  });
  it("returns nothing for a title made of filler", () => {
    expect(similarQueryTerms("Und was ist das?")).toEqual([]);
    expect(similarQueryTerms("")).toEqual([]);
  });
});

describe("rankScriptHits", () => {
  it("merges lists by reciprocal rank", () => {
    const ranked = rankScriptHits([
      [hit("a"), hit("b"), hit("c")],
      [hit("b"), hit("d")],
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
    expect(ranked[0].score).toBeCloseTo(1.5);
  });
  it("skips excluded ids", () => {
    expect(rankScriptHits([[hit("a"), hit("b")]], new Set(["a"])).map((r) => r.id)).toEqual(["b"]);
  });
  it("handles empty input", () => {
    expect(rankScriptHits([])).toEqual([]);
    expect(rankScriptHits([[], []])).toEqual([]);
  });
});

describe("similarIdeas", () => {
  const all = [
    { id: "1", title: "Kaffeemaschine kaputt - Krisensitzung", used_at: null },
    { id: "2", title: "Krisensitzung wegen Kaffeemaschine", used_at: 5 },
    { id: "3", title: "Wohnungsbesichtigung mit 40 Leuten", used_at: null },
  ];
  it("finds ideas with overlapping title words, excluding itself", () => {
    const res = similarIdeas(all[0], all);
    expect(res.map((r) => r.id)).toEqual(["2"]);
    expect(res[0].used).toBe(true);
  });
  it("returns nothing when nothing overlaps", () => {
    expect(similarIdeas(all[2], all)).toEqual([]);
  });
});
