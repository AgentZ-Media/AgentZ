import { describe, expect, it } from "vitest";
import {
  CLAIM_BATCH, claimCandidates, claimKey, claimProbabilities, claimWindow, isSmallEdit, lineRequest, scriptRequests,
} from "../claimScan";
import type { AgentBlock } from "../scriptText";

const b = (type: AgentBlock["type"], text: string): AgentBlock => ({ type, text });

const script: AgentBlock[] = [
  b("action", "Büro. TIMO legt AXEL einen Urlaubsantrag hin."), // 0
  b("character", "Timo"), // 1
  b("dialog", "Ich nehm meine Resttage vom letzten Jahr."), // 2
  b("character", "Axel"), // 3
  b("parenthetical", "(ohne aufzusehen)"), // 4
  b("dialog", "Resturlaub verfällt am 31. Dezember. Immer."), // 5
  b("character", "Timo"), // 6
  b("dialog", "Steht so im Bundesurlaubsgesetz, glaub mir."), // 7
  b("character", "Axel"), // 8
  b("dialog", "Das Gesetz ist doch uralt."), // 9
  b("character", "Timo"), // 10
  b("dialog", "Von 1963. Älter als du."), // 11
  b("character", "Axel"), // 12
  b("dialog", "Hmm."), // 13
  b("character", "Timo"), // 14
  b("dialog", "Dann zieh doch nach Bayern, Axel."), // 15
];

describe("claimCandidates", () => {
  it("takes dialog lines with at least four words", () => {
    expect(claimCandidates(script)).toEqual([2, 5, 7, 9, 11, 15]);
  });
});

describe("claimKey", () => {
  it("follows the text, ignoring case and spacing", () => {
    expect(claimKey("Die Mauer  ist 1989 gefallen.")).toBe(claimKey(" die mauer ist 1989 gefallen. "));
    expect(claimKey("Die Mauer ist 1989 gefallen.")).not.toBe(claimKey("Die Mauer ist 1990 gefallen."));
  });
});

describe("scriptRequests", () => {
  it("sends the whole numbered script with one yes/no question per line", () => {
    const [request, ...rest] = scriptRequests(script, [5, 11]);
    expect(rest).toEqual([]);
    expect(request.state).toEqual({ script: expect.stringContaining("[11] DIALOG (TIMO): Von 1963. Älter als du.") });
    expect(String((request.state as { script: string }).script).split("\n")).toHaveLength(script.length);
    expect(Object.keys(request.questions)).toEqual(["b5", "b11"]);
    expect(request.questions.b11).toMatchObject({ type: "noul", instructions: expect.stringContaining("line [11]") });
  });

  it("splits long scripts into batches", () => {
    const long = Array.from({ length: CLAIM_BATCH + 5 }, (_, i) => b("dialog", `Zeile ${i} mit genug Wörtern drin.`));
    const requests = scriptRequests(long, claimCandidates(long));
    expect(requests.map((r) => Object.keys(r.questions).length)).toEqual([CLAIM_BATCH, 5]);
    expect(scriptRequests(long, [])).toEqual([]);
  });
});

describe("claimWindow / lineRequest", () => {
  it("reads two dialog lines before and after, with the names above", () => {
    expect(claimWindow(script, 11)).toEqual({ from: 6, to: 15 });
    // At the start: the names above the first dialog line count, the action not.
    expect(claimWindow(script, 2)).toEqual({ from: 1, to: 7 });
  });

  it("keeps the script numbers of the excerpt", () => {
    const request = lineRequest(script, 11);
    const lines = String((request.state as { script: string }).script).split("\n");
    expect(lines[0]).toBe("[6] CHARACTER: Timo");
    expect(lines).toContain("[9] DIALOG (AXEL): Das Gesetz ist doch uralt.");
    expect(lines[lines.length - 1]).toBe("[15] DIALOG (TIMO): Dann zieh doch nach Bayern, Axel.");
    expect(Object.keys(request.questions)).toEqual(["b11"]);
  });
});

describe("claimProbabilities", () => {
  it("maps answers back to block indices", () => {
    const map = claimProbabilities({
      b5: { type: "noul", noul: 0.95 },
      b11: { type: "noul", noul: 0.84 },
      other: { type: "noul", noul: 1 },
      b2: { type: "choice", choice: "x", confidence: null, probabilities: {} },
    });
    expect([...map]).toEqual([[5, 0.95], [11, 0.84]]);
  });
});

describe("isSmallEdit", () => {
  const line = "Resturlaub verfällt am 31. Dezember. Immer.";

  it("keeps typos, punctuation and one changed word", () => {
    expect(isSmallEdit(line, "Resturlaub verfällt am 31. Dezember. Imer.")).toBe(true);
    expect(isSmallEdit(line, "Resturlaub verfällt am 31. Dezember - immer!")).toBe(true);
    expect(isSmallEdit(line, "Resturlaub verfällt am 30. Dezember. Immer.")).toBe(true);
  });

  it("asks again after a rewrite or an added claim", () => {
    expect(isSmallEdit(line, "Resturlaub verfällt nie, im Dezember. Imer.")).toBe(false);
    expect(isSmallEdit(line, "Resturlaub verfällt am 31. Dezember, steht seit 1963 im Gesetz.")).toBe(false);
    expect(isSmallEdit(line, "Deutschland hat die meisten Feiertage in Europa.")).toBe(false);
    expect(isSmallEdit("", line)).toBe(false);
  });
});
