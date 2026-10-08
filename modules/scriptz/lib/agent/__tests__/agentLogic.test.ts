import { describe, expect, it } from "vitest";
import { markdownToPlain, parseInline, parseMarkdown } from "../markdown";
import { anchorTarget, parseClaims, parseProposal, parseTarget, resolveTarget } from "../proposals";
import { charactersIn, hashBlocks, numberedScript } from "../scriptText";
import { relationSubject, selectRelevantMemory, type MemoryEntry } from "../memory";
import { memoryBlock, personaBlock } from "../prompt";
import { planLabel } from "../codex/provider";

describe("agent markdown", () => {
  it("parses paragraphs, lists and inline marks without HTML", () => {
    const blocks = parseMarkdown("Hallo **Welt** und *kursiv*.\n\n- eins\n- `zwei`\n\n1. a\n2. b");
    expect(blocks.map((b) => b.t)).toEqual(["p", "ul", "ol"]);
    expect(parseInline("**fett**")).toEqual([{ t: "bold", c: [{ t: "text", v: "fett" }] }]);
    expect(parseMarkdown("<script>alert(1)</script>")[0]).toEqual({ t: "p", c: [{ t: "text", v: "<script>alert(1)</script>" }] });
  });

  it("only links http(s) urls", () => {
    expect(parseInline("[x](javascript:alert(1))").some((n) => n.t === "link")).toBe(false);
    const link = parseInline("Quelle: [BGB](https://www.gesetze-im-internet.de/bgb/__612.html).").find((n) => n.t === "link");
    expect(link && link.t === "link" ? link.href : "").toContain("gesetze-im-internet.de");
  });

  it("flattens headings and ignores snake_case underscores", () => {
    expect(parseMarkdown("## Titel")[0]).toEqual({ t: "p", c: [{ t: "bold", c: [{ t: "text", v: "Titel" }] }] });
    expect(markdownToPlain("read_script und get_memory")).toBe("read_script und get_memory");
  });
});

describe("agent proposals", () => {
  it("parses options and normalizes block text", () => {
    const proposal = parseProposal({
      target: { mode: "replace", from: 4, to: 2 },
      options: [
        { title: "A", blocks: [{ type: "character", text: "timo" }, { type: "parenthetical", text: "leise" }, { type: "dialog", text: "Ja." }] },
        { title: "leer", blocks: [] },
        { title: "B", blocks: [{ type: "camera", text: "x" }, { type: "action", text: "Er geht." }] },
      ],
    }, 10);
    expect(proposal?.target).toEqual({ mode: "replace", from: 2, to: 4 });
    expect(proposal?.options).toHaveLength(2);
    expect(proposal?.options[0].blocks.map((b) => b.text)).toEqual(["TIMO", "(leise)", "Ja."]);
    expect(proposal?.options[1].blocks).toEqual([{ type: "action", text: "Er geht." }]);
  });

  it("falls back to append for missing targets and rejects stale indices", () => {
    expect(parseTarget({ mode: "replace" }, 5)).toEqual({ mode: "append" });
    expect(parseTarget(null, 5)).toEqual({ mode: "append" });
    expect(parseTarget({ mode: "insert_after", block: 99 }, 5)).toBeNull();
    expect(parseTarget({ mode: "replace", from: 3, to: 7 }, 5)).toBeNull();
    expect(parseTarget({ mode: "replace", from: 3, to: 7 }, 0)).toEqual({ mode: "append" });
    expect(parseProposal({ target: { mode: "insert_after", block: 9 }, options: [{ title: "A", blocks: [{ type: "action", text: "x" }] }] }, 5)).toBeNull();
  });

  it("anchors targets and only applies them where the text still matches", () => {
    const texts = ["Büro.", "TIMO", "Ja.", "AXEL", "Nein."];
    const target = anchorTarget({ mode: "replace", from: 1, to: 2 }, texts);
    expect(target).toEqual({ mode: "replace", from: 1, to: 2, anchor: ["TIMO", "Ja."] });
    expect(resolveTarget(target, texts)).toEqual(target);
    expect(resolveTarget(target, ["Neu.", ...texts])).toEqual({ ...target, from: 2, to: 3 });
    expect(resolveTarget(target, ["Büro.", "TIMO", "Doch.", "AXEL"])).toBeNull();
    // Ambiguous after the move: refuse rather than guess.
    expect(resolveTarget(target, ["TIMO", "Ja.", "x", "TIMO", "Ja."])).toBeNull();
    expect(resolveTarget({ mode: "insertAfter", block: 4 }, texts.slice(0, 3))).toBeNull();
    expect(resolveTarget({ mode: "append" }, [])).toEqual({ mode: "append" });
  });

  it("keeps only safe source urls in claims", () => {
    const claims = parseClaims({ claims: [{ quote: "Q", verdict: "wrong", explanation: "E", sources: [{ url: "https://example.org/a" }, { url: "file:///etc/passwd" }] }] }, 3);
    expect(claims[0].sources.map((s) => s.url)).toEqual(["https://example.org/a"]);
    expect(parseClaims({ claims: [{ quote: "Q", verdict: "maybe" }] }, 3)[0].verdict).toBe("unclear");
  });
});

describe("agent script text", () => {
  const blocks = [
    { type: "action" as const, text: "Büro." },
    { type: "character" as const, text: "timo" },
    { type: "parenthetical" as const, text: "(leise)" },
    { type: "dialog" as const, text: "Fertig." },
  ];
  it("numbers blocks and repeats the speaker", () => {
    expect(numberedScript(blocks)).toBe("[0] ACTION: Büro.\n[1] CHARACTER: timo\n[2] PARENTHETICAL (TIMO): (leise)\n[3] DIALOG (TIMO): Fertig.");
    expect(charactersIn(blocks)).toEqual(["TIMO"]);
  });
  it("hashes deterministically and detects edits", () => {
    expect(hashBlocks(blocks)).toBe(hashBlocks([...blocks]));
    expect(hashBlocks(blocks)).not.toBe(hashBlocks([...blocks, { type: "action", text: "x" }]));
  });
});

describe("agent memory selection", () => {
  const entry = (partial: Partial<MemoryEntry>): MemoryEntry => ({
    id: Math.random().toString(36), kind: "global", folderId: null, subject: null, content: "c",
    source: "chat", sourceScriptId: null, createdAt: 0, updatedAt: 0, ...partial,
  });
  const all = [
    entry({ kind: "global", content: "Enden hart" }),
    entry({ kind: "folder", folderId: "kolbe", content: "warm" }),
    entry({ kind: "folder", folderId: "agentz", content: "Büro" }),
    entry({ kind: "character", subject: "TIMO", content: "Grundprofil" }),
    entry({ kind: "character", subject: "TIMO", folderId: "kolbe", content: "Pfleger" }),
    entry({ kind: "character", subject: "TIMO", folderId: "agentz", content: "Angestellter" }),
    entry({ kind: "relation", subject: relationSubject("timo", "Axel"), folderId: "agentz", content: "Logik vs Hierarchie" }),
  ];
  it("picks global, the folder and the folder's version of a character", () => {
    const picked = selectRelevantMemory(all, "kolbe", ["Timo"]).map((e) => e.content);
    expect(picked).toEqual(["Enden hart", "warm", "Grundprofil", "Pfleger"]);
  });
  it("includes relations only when both characters appear", () => {
    expect(selectRelevantMemory(all, "agentz", ["TIMO"]).some((e) => e.kind === "relation")).toBe(false);
    expect(selectRelevantMemory(all, "agentz", ["TIMO", "AXEL"]).some((e) => e.kind === "relation")).toBe(true);
  });
  it("renders memory with scope headings and ids", () => {
    const text = memoryBlock(all.slice(0, 2), new Map([["kolbe", { id: "kolbe", name: "Pflegedienst Kolbe" } as never]]));
    expect(text).toContain("General knowledge");
    expect(text).toContain('folder "Pflegedienst Kolbe"');
    expect(text).toContain("(id ");
  });
});

describe("plan labels", () => {
  it("formats ChatGPT plan ids", () => {
    expect(planLabel("prolite")).toBe("Pro Lite");
    expect(planLabel("plus")).toBe("Plus");
    expect(planLabel("unknown")).toBe("");
    expect(planLabel("studio")).toBe("Studio");
  });
});

describe("persona language", () => {
  it("answers tasks the app writes in English in the user's language", () => {
    const text = personaBlock({ name: "Ida", userName: "", language: "de", traits: [], instructions: "" });
    expect(text).toContain("Always answer in German");
    expect(text).toContain("answer those in German as well");
  });
});
