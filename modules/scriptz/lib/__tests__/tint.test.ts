import { describe, expect, it } from "vitest";
import { tintKindOf, tintSpeakers } from "../tint";

const b = (kind: "character" | "dialog" | "paren" | "other", text = "") => ({ kind, text });

describe("tintSpeakers", () => {
  it("tints a character line and the speech run below it", () => {
    expect(tintSpeakers([b("character", "Timo"), b("paren", "(leise)"), b("dialog", "Fertig.")])).toEqual(["TIMO", "TIMO", "TIMO"]);
  });

  it("ends the speech run at an action block", () => {
    expect(tintSpeakers([b("character", "Axel"), b("dialog", "Nein."), b("other", "Stille."), b("dialog", "Doch.")])).toEqual(["AXEL", "AXEL", null, null]);
  });

  it("leaves an empty character line and its dialog untinted", () => {
    expect(tintSpeakers([b("character", "  "), b("dialog", "Hm.")])).toEqual([null, null]);
  });
});

describe("tintKindOf", () => {
  it("maps block types and treats everything else as action", () => {
    expect(tintKindOf("scriptz-character")).toBe("character");
    expect(tintKindOf("scriptz-dialog")).toBe("dialog");
    expect(tintKindOf("scriptz-parenthetical")).toBe("paren");
    expect(tintKindOf("scriptz-action")).toBe("other");
  });
});
