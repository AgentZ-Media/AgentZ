import { describe, expect, it } from "vitest";
import {
  changedBlocks,
  collectDrafts,
  contentJsonFromBlocks,
  draftBodyFromBlocks,
  draftPlainText,
  draftRuntime,
  draftSlug,
  draftWords,
  parseDraftBody,
  splitDraftSegments,
  textWithoutDrafts,
} from "../drafts";
import { draftStates, parseItems, summarizeSession, type ChatItem } from "../chats";
import { ideaNotes, parseIdeaCards, parseReplies } from "../sessionTools";
import { describeTarget, dialogWordsFor, writingTarget } from "../writingContext";
import { extractBlocks } from "../../lex";
import { runtimeSeconds, runtimeStatsFromContent } from "../../runtime";
import type { Folder } from "../../types";

const DRAFT = `Hier ist der erste Entwurf.

:::draft id="maus" title="Die Mausbewegung" idea="0f8fad5b-d9cb-469f-a165-70867728950e"
ACTION: Homeoffice. Timo liegt auf dem Sofa.
AXEL: Timo. Deine Maus hat sich seit 11:42 nicht bewegt.
TIMO (leise): Ich denke nach.
(seufzt)
Später: die Maus liegt auf einem Brett.
:::

Etwa 0:55, im Ziel.`;

describe("agent mode drafts", () => {
  it("splits a reply into text and a complete draft block", () => {
    const segments = splitDraftSegments(DRAFT);
    expect(segments.map((s) => s.kind)).toEqual(["text", "draft", "text"]);
    const draft = segments[1];
    if (draft.kind !== "draft") throw new Error("expected a draft");
    expect(draft.complete).toBe(true);
    expect(draft.attrs).toEqual({ slug: "maus", title: "Die Mausbewegung", ideaId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    expect(textWithoutDrafts(DRAFT)).toBe("Hier ist der erste Entwurf.\n\nEtwa 0:55, im Ziel.");
  });

  it("parses the lines into the four block types", () => {
    const body = splitDraftSegments(DRAFT)[1];
    if (body.kind !== "draft") throw new Error("expected a draft");
    expect(parseDraftBody(body.body)).toEqual([
      { type: "action", text: "Homeoffice. Timo liegt auf dem Sofa." },
      { type: "character", text: "AXEL" },
      { type: "dialog", text: "Timo. Deine Maus hat sich seit 11:42 nicht bewegt." },
      { type: "character", text: "TIMO" },
      { type: "parenthetical", text: "(leise)" },
      { type: "dialog", text: "Ich denke nach." },
      { type: "parenthetical", text: "(seufzt)" },
      // Not an upper-case speaker: stays an action line.
      { type: "action", text: "Später: die Maus liegt auf einem Brett." },
    ]);
  });

  it("keeps a draft open while it streams and includes the partial line", () => {
    const partial = 'Los gehts.\n:::draft id="a" title="A"\nACTION: Ein Raum.\nTIMO: Ich bin noch nicht fer';
    const segments = splitDraftSegments(partial);
    const draft = segments[1];
    if (draft.kind !== "draft") throw new Error("expected a draft");
    expect(draft.complete).toBe(false);
    expect(parseDraftBody(draft.body).at(-1)).toEqual({ type: "dialog", text: "Ich bin noch nicht fer" });
  });

  it("shows a speaker that is still being written as the speaker", () => {
    expect(parseDraftBody("ACTION: Ein Raum.\nTIMO (gri", true)).toEqual([
      { type: "action", text: "Ein Raum." },
      { type: "character", text: "TIMO" },
      { type: "parenthetical", text: "(gri" },
    ]);
    // Once the message is done, an unfinished line stays as written.
    expect(parseDraftBody("TIMO (gri").at(-1)).toEqual({ type: "action", text: "TIMO (gri" });
    // Lower-case words are never taken for a speaker.
    expect(parseDraftBody("Später geht", true)).toEqual([{ type: "action", text: "Später geht" }]);
  });

  it("collects versions per draft id and closes drafts of stopped messages", () => {
    const items: ChatItem[] = [
      { kind: "assistant", id: "m1", text: ':::draft id="maus" title="Maus"\nTIMO: Eins.\n:::' },
      { kind: "user", id: "u1", text: "kürzer" },
      { kind: "assistant", id: "m2", text: ':::draft id="maus"\nTIMO: Zwei.\n:::\n:::draft id="other" title="Anders"\nACTION: x\n:::' },
      // Interrupted without the closing fence, no longer streaming.
      { kind: "assistant", id: "m3", text: ':::draft id="maus"\nTIMO: Drei', streaming: false },
      { kind: "assistant", id: "m4", text: ':::draft id="live" title="Live"\nTIMO: Noch', streaming: true },
    ];
    const drafts = collectDrafts(items);
    expect(drafts.map((d) => d.slug)).toEqual(["maus", "other", "live"]);
    const maus = drafts[0];
    expect(maus.versions.map((v) => v.id)).toEqual(["m1#0", "m2#0", "m3#0"]);
    // A revision without a title keeps the previous one.
    expect(maus.versions[1].title).toBe("Maus");
    expect(maus.versions[2].complete).toBe(true);
    expect(drafts[2].versions[0].complete).toBe(false);
  });

  it("derives open, finished and discarded states from the chat", () => {
    const base: ChatItem[] = [
      { kind: "assistant", id: "m1", text: ':::draft id="a" title="A"\nTIMO: Eins.\n:::\n:::draft id="b" title="B"\nTIMO: Zwei.\n:::' },
      { kind: "handoff", id: "h1", scriptId: "s1", title: "A", slug: "a", versionId: "m1#0", folderId: null, at: 1 },
      { kind: "draft-discarded", id: "d1", slug: "b", versionId: "m1#1" },
    ];
    expect(draftStates(base).map((s) => s.state)).toEqual(["finished", "discarded"]);
    // A new version after finishing reopens the draft.
    const revised: ChatItem[] = [...base, { kind: "assistant", id: "m2", text: ':::draft id="a"\nTIMO: Neu.\n:::' }];
    expect(draftStates(revised).map((s) => s.state)).toEqual(["open", "discarded"]);
    const summary = summarizeSession({ id: "c", title: "T", folderId: null, scriptId: null, updatedAt: 5, items: revised });
    expect(summary).toMatchObject({ openDrafts: 1, finished: 1, lastDraft: "B", lastDraftVersion: 1 });
  });

  it("marks new and changed lines between versions, not speaker names", () => {
    const v1 = parseDraftBody("ACTION: Ein Büro.\nAXEL: Keine Bewegung, keine Arbeitszeit.\nTIMO: Ich hab mich neu motiviert.");
    const v2 = parseDraftBody("ACTION: Ein Büro.\nAXEL: Keine Bewegung, kein Gehalt.\nTIMO: Ich hab mich neu motiviert.\nTIMO: Er ist dran.");
    expect([...changedBlocks(v1, v2)].sort((a, b) => a - b)).toEqual([2, 6]);
    expect(changedBlocks(v1, v1).size).toBe(0);
  });

  it("builds Lexical content the script lib reads back", () => {
    const blocks = parseDraftBody("ACTION: Ein Büro.\nTIMO (leise): Hallo.\nAXEL: Tschüss.");
    const json = contentJsonFromBlocks(blocks);
    const extracted = extractBlocks(json).filter((b) => b.text.trim());
    expect(extracted.map((b) => [b.kind, b.text])).toEqual([
      ["scriptz-action", "Ein Büro."],
      ["scriptz-character", "TIMO"],
      ["scriptz-parenthetical", "(leise)"],
      ["scriptz-dialog", "Hallo."],
      ["scriptz-character", "AXEL"],
      ["scriptz-dialog", "Tschüss."],
    ]);
    const root = (JSON.parse(json) as { root: { children: { type: string; characterName?: string; children: unknown[] }[] } }).root;
    expect(root.children.find((c) => c.type === "scriptz-character")?.characterName).toBe("TIMO");
    // Trailing empty action block without children (caret place).
    expect(root.children.at(-1)).toMatchObject({ type: "scriptz-action", children: [] });
  });

  it("measures runtime and words like the timeline", () => {
    const blocks = parseDraftBody(`ACTION: Ein Büro.\nTIMO: ${"wort ".repeat(210).trim()}`);
    // 210 dialog words at 210 WPM = 60 s, plus 2 s for the action line.
    expect(draftRuntime(blocks, 210)).toBe(62);
    expect(draftRuntime([], 210)).toBe(0);
    expect(draftWords(blocks)).toBe(212);
  });

  it("counts every action block like the script runtime", () => {
    const blocks = [
      { type: "action" as const, text: "" },
      { type: "character" as const, text: "TIMO" },
      { type: "dialog" as const, text: ` ${"wort  ".repeat(10)}` },
    ];
    const json = JSON.stringify({
      root: { type: "root", children: blocks.map((b) => ({ type: `scriptz-${b.type}`, children: [{ type: "text", text: b.text }] })) },
    });
    // 10 words at 60 WPM = 10 s, plus 2 s for the empty action line.
    expect(draftRuntime(blocks, 60)).toBe(12);
    expect(draftRuntime(blocks, 60)).toBe(runtimeSeconds(runtimeStatsFromContent(json), 60));
    expect(draftWords(blocks)).toBe(10);
  });

  it("round-trips blocks as draft text and exports plain text", () => {
    const blocks = parseDraftBody("ACTION: Ein Büro.\nTIMO (leise): Hallo.");
    expect(parseDraftBody(draftBodyFromBlocks(blocks))).toEqual(blocks);
    expect(draftPlainText("Titel", blocks)).toBe("Titel\n\nEin Büro.\n\nTIMO\n(leise)\nHallo.");
  });

  it("slugs titles", () => {
    expect(draftSlug("Die Mausbewegung!")).toBe("die-mausbewegung");
    expect(draftSlug("Straße & Größe")).toBe("strasse-grosse");
    expect(draftSlug("")).toBe("draft");
  });
});

describe("agent mode chat items", () => {
  it("keeps the new item kinds when loading and drops unknown ones", () => {
    const items = parseItems(JSON.stringify([
      { kind: "ideas", id: "i", folderId: null, ideas: [], picked: [], savedIds: [] },
      { kind: "ideas-saved", id: "s", folderId: null, saved: [] },
      { kind: "replies", id: "r", replies: ["Ja"] },
      { kind: "handoff", id: "h", scriptId: "x", title: "T", slug: "a", versionId: "m#0", folderId: null, at: 1 },
      { kind: "draft-discarded", id: "d", slug: "a", versionId: "m#0" },
      { kind: "something-new", id: "n" },
    ]));
    expect(items.map((i) => i.kind)).toEqual(["ideas", "ideas-saved", "replies", "handoff", "draft-discarded"]);
  });
});

describe("agent mode tools", () => {
  it("parses idea cards defensively", () => {
    const cards = parseIdeaCards([
      { title: "  Pflicht-Kamera ", premise: "Axel will Kamera an.", hook: "Kamera an!", characters: ["timo", "", "axel"], seconds: 49.6 },
      { premise: "ohne Titel" },
      "kaputt",
      { title: "Lob-Quote", premise: "x", seconds: -3 },
    ]);
    expect(cards).toEqual([
      { title: "Pflicht-Kamera", premise: "Axel will Kamera an.", hook: "Kamera an!", characters: ["TIMO", "AXEL"], seconds: 50 },
      { title: "Lob-Quote", premise: "x", hook: "", characters: [], seconds: null },
    ]);
    expect(ideaNotes(cards[0])).toBe("Axel will Kamera an.\n\nHook: Kamera an!\n\nTIMO, AXEL");
  });

  it("dedupes and caps quick replies", () => {
    expect(parseReplies(["Ja", "ja", " ", "Kürzer", "Mehr", "Andere", "Fünfte"])).toEqual(["Ja", "Kürzer", "Mehr", "Andere"]);
  });

  it("turns a length target into a word budget", () => {
    const folder = { id: "f", name: "Büro", script_count: 0, length_min_sec: 45, length_max_sec: 65 } as Folder;
    const target = writingTarget(folder, { wpm: 210, defaults: { minSec: null, maxSec: null } });
    expect(target.fromFolder).toBe(true);
    expect(target.dialogWords).toEqual({ min: dialogWordsFor(45, 210), max: dialogWordsFor(65, 210) });
    expect(dialogWordsFor(68, 210)).toBe(210);
    expect(describeTarget(target)).toContain("0:45-1:05");
    const none = writingTarget(null, { wpm: 180, defaults: { minSec: null, maxSec: null } });
    expect(none.range).toBeNull();
    expect(describeTarget(none)).toContain("no length target");
  });
});
