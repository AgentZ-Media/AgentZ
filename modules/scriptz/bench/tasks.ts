// Tasks of the agent benchmark: each one is a real request of the app on a
// demo profile, sent through the app's own path (chat store, fact check of a
// line, learning), plus checks that the bench app shows next to the result.
// Checks look at what the user would see (chat items, cards, drafts) and at
// how the model used the tools.

import { formatRange } from "../lib/lengthGoal";
import type { ChatItem } from "../lib/agent/chats";
import { draftRuntime, parseDraftBody, splitDraftSegments, textWithoutDrafts } from "../lib/agent/drafts";
import { jobInstruction, voiceInstruction, type AgentJobId } from "../lib/agent/jobs";
import type { Claim, Proposal } from "../lib/agent/proposals";
import type { AgentBlock } from "../lib/agent/scriptText";
import type { MemoryChange } from "../lib/agent/tools";
import { measureBlocks } from "../components/Agent/proposalMetrics";
import type { ChatQuote, SendOptions } from "../stores/agent/types";
import type { Profile } from "./profiles/types";
import type { World } from "./world";

export interface Text { de: string; en: string }
export interface Check { id: string; label: Text; pass: boolean; detail?: string }

export interface ToolCall { name: string; args: string; atMs: number }

/** Everything a task produced, as the checks and the bench app see it. */
export interface TaskResult {
  /** Chat items of this turn (what the chat shows). */
  items: ChatItem[];
  /** Fact check of a line: the card under the line and the short note. */
  claim?: { claim: Claim | null; note: string };
  /** Learning: what changed in the memory. */
  memoryChanges?: MemoryChange[];
  /** Tool calls in order, from the model's responses (web search too). */
  toolCalls: ToolCall[];
  /** Items of the turn before in the same conversation (revisions). */
  previousItems: ChatItem[];
}

export type Request =
  | { kind: "chat"; text: string; quote?: ChatQuote; options?: SendOptions }
  | { kind: "claim"; index: number; text: string }
  | { kind: "learn" };

export interface Task {
  id: string;
  profile: string;
  label: Text;
  /** Turns of one conversation run in order on the same chat. */
  conversation: string;
  /** script = chat of an open script, session = agent mode, claim/learn =
   *  background threads of the app. */
  mode: "script" | "session" | "claim" | "learn";
  script?: string;
  folder?: string;
  /** Tasks that write memory run after the others of their world. */
  phase: 1 | 2;
  request(world: World): Request;
  /** For the judge: what matters (German). */
  rubric: string;
  checks(result: TaskResult, world: World): Check[];
}

// ----------------------------------------------------------------- helpers

const check = (id: string, de: string, en: string, pass: boolean, detail?: string): Check => ({ id, label: { de, en }, pass, ...(detail ? { detail } : {}) });
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const wpmOf = (world: World) => Number(world.profile.settings.dialog_wpm ?? 160);
const SECONDS_STATED = /\b\d+([,.]\d+)?\s*(s|sek\.?|sekunden|seconds)\b|\b\d:\d\d\b/i;
const GERMAN = /\b(und|nicht|der|die|das|ist|sind|ein|eine|bei|nach|mit|erst|auf)\b/i;
const ENGLISH = /\b(the|and|is|are|with|after)\b/i;
const BERLIN = /\b(dit|ick|wat|nich|jerne|se|wa|nen|haben wa|is)\b/gi;

function folderRange(profile: Profile, key: string | undefined) {
  const folder = profile.folders.find((f) => f.key === key);
  return folder ? { minSec: folder.minSec, maxSec: folder.maxSec } : null;
}
function scriptFolder(profile: Profile, key: string) {
  return profile.scripts.find((s) => s.key === key)?.folder;
}

/** The message the chat panel sends for a fixed job (ChatPanel.runJob). */
function job(world: World, key: string, id: AgentJobId, label: string): Request {
  const blocks = world.blocks.get(key) ?? [];
  const wpm = wpmOf(world);
  const runtime = measureBlocks(blocks, wpm).runtimeSec;
  const range = folderRange(world.profile, scriptFolder(world.profile, key));
  return { kind: "chat", text: label, options: { instruction: jobInstruction(id, { range: formatRange(range), runtime: clock(runtime), wpm }), job: id } };
}

const toolNames = (r: TaskResult) => r.toolCalls.map((c) => c.name);
const called = (r: TaskResult, ...names: string[]) => names.some((n) => toolNames(r).includes(n));
const firstIndex = (r: TaskResult, name: string) => toolNames(r).indexOf(name);
const proposals = (items: ChatItem[]) => items.flatMap((i) => (i.kind === "proposal" ? [i.proposal] : []));
const ideaBoards = (items: ChatItem[]) => items.flatMap((i) => (i.kind === "ideas" ? [i.ideas] : []));
const replies = (items: ChatItem[]) => items.flatMap((i) => (i.kind === "replies" ? i.replies : []));
const answerText = (items: ChatItem[]) => items.filter((i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant").map((i) => i.text).join("\n\n");

export interface Draft { slug: string; title: string; lines: string[]; blocks: AgentBlock[]; runtimeSec: number }

export function draftsOf(items: ChatItem[], wpm: number): Draft[] {
  return splitDraftSegments(answerText(items)).flatMap((s) => {
    if (s.kind !== "draft" || !s.complete) return [];
    const blocks = parseDraftBody(s.body);
    return [{ slug: s.attrs.slug, title: s.attrs.title, lines: s.body.split("\n").map((l) => l.trim()).filter(Boolean), blocks, runtimeSec: draftRuntime(blocks, wpm) }];
  });
}

/** The script after an option of a proposal is inserted. */
export function applyOption(blocks: AgentBlock[], proposal: Proposal, option: number): AgentBlock[] {
  const next = proposal.options[option]?.blocks ?? [];
  const t = proposal.target;
  if (t.mode === "replace") return [...blocks.slice(0, t.from), ...next, ...blocks.slice(t.to + 1)];
  if (t.mode === "insertAfter") return [...blocks.slice(0, t.block + 1), ...next, ...blocks.slice(t.block + 1)];
  return [...blocks, ...next];
}

const speakers = (blocks: AgentBlock[]) => new Set(blocks.filter((b) => b.type === "character").map((b) => b.text.trim().toUpperCase()));

/** Dialog lines of one character. */
function linesOf(blocks: AgentBlock[], name: string): string[] {
  const out: string[] = [];
  let speaker = "";
  for (const b of blocks) {
    if (b.type === "character") speaker = b.text.trim().toUpperCase();
    else if (b.type === "action") speaker = "";
    else if (b.type === "dialog" && speaker === name) out.push(b.text);
  }
  return out;
}
const berlinMarkers = (lines: string[]) => lines.join(" ").match(BERLIN)?.length ?? 0;
const DRAFT_LINE = /^[A-ZÄÖÜ][A-ZÄÖÜ .-]{0,39}( \([^)]{1,80}\))?: \S/;

function cardChecks(r: TaskResult, min = 2, max = 3): { p: Proposal | undefined; checks: Check[] } {
  const p = proposals(r.items).at(-1);
  const read = firstIndex(r, "get_current_script");
  const shown = firstIndex(r, "propose_options");
  return {
    p,
    checks: [
      check("read", "Liest zuerst das Skript", "Reads the script first", read >= 0 && (shown < 0 || read < shown)),
      check("card", "Vorschlagskarte gezeigt", "Option card shown", !!p),
      check("options", `${min}-${max} Optionen`, `${min}-${max} options`, !!p && p.options.length >= min && p.options.length <= max, p ? String(p.options.length) : undefined),
    ],
  };
}

function draftChecks(r: TaskResult, world: World, folder: string, cast: string[]): { draft: Draft | undefined; checks: Check[] } {
  const wpm = wpmOf(world);
  const draft = draftsOf(r.items, wpm).at(-1);
  const range = folderRange(world.profile, folder);
  const text = textWithoutDrafts(answerText(r.items));
  const bad = draft?.lines.filter((l) => !DRAFT_LINE.test(l)) ?? [];
  const names = draft ? speakers(draft.blocks) : new Set<string>();
  const inRange = !!draft && !!range && (range.minSec === null || draft.runtimeSec >= range.minSec) && (range.maxSec === null || draft.runtimeSec <= range.maxSec);
  return {
    draft,
    checks: [
      check("draft", "Entwurf geschrieben", "Draft written", !!draft),
      check("format", "Format sauber (NAME: Text)", "Clean format (NAME: text)", !!draft && bad.length === 0, bad[0]?.slice(0, 80)),
      check("length", `Im Zielbereich ${formatRange(range)}`, `Within the target ${formatRange(range)}`, inRange, draft ? clock(draft.runtimeSec) : undefined),
      check("cast", `Besetzung: ${cast.join(", ")}`, `Cast: ${cast.join(", ")}`, cast.every((c) => names.has(c)), [...names].join(", ") || undefined),
      check("noRuntime", "Nennt keine eigene Laufzeit", "States no runtime of its own", !SECONDS_STATED.test(text)),
      check("short", "Kurzer Begleittext", "Short accompanying text", text.length <= 300, String(text.length)),
    ],
  };
}

function factChecks(r: TaskResult, verdicts: Claim["verdict"][], explanation: RegExp[], fix: RegExp): Check[] {
  const claim = r.claim?.claim ?? null;
  const fixText = claim?.fix?.blocks.map((b) => b.text).join(" ") ?? "";
  return [
    check("read", "Liest das ganze Skript", "Reads the whole script", called(r, "get_current_script")),
    check("searched", "Sucht im Web", "Searches the web", called(r, "web_search")),
    check("card", "Faktencheck-Karte gezeigt", "Fact check card shown", !!claim),
    check("verdict", "Urteil richtig", "Correct verdict", !!claim && verdicts.includes(claim.verdict), claim?.verdict),
    check("rule", "Erklärt die Regel richtig", "Explains the rule correctly", !!claim && explanation.every((re) => re.test(claim.explanation))),
    check("sources", "Quelle mit Link", "Source with a link", !!claim && claim.sources.some((s) => /^https?:\/\//.test(s.url)), claim ? String(claim.sources.length) : undefined),
    check("fix", "Korrektur angeboten", "Offers a fix", !!claim?.fix),
    check("fixRight", "Korrektur ist richtig", "The fix is correct", fix.test(fixText), fixText.slice(0, 100) || undefined),
    check("german", "Erklärung auf Deutsch", "Explanation in German", !!claim && GERMAN.test(claim.explanation) && !ENGLISH.test(claim.explanation)),
  ];
}

function ideaChecks(r: TaskResult, world: World, count: number, cast: string[]): Check[] {
  const board = ideaBoards(r.items).at(-1) ?? [];
  const known = [...world.profile.scripts.map((s) => s.title), ...world.profile.ideas.map((i) => i.title)].map((t) => t.toLowerCase());
  const doubles = board.filter((i) => known.includes(i.title.toLowerCase()));
  const castOk = board.filter((i) => cast.every((c) => i.characters.includes(c))).length;
  return [
    check("looked", "Schaut sich den Ordner an", "Looks at the folder", called(r, "list_scripts", "read_script", "search_scripts", "list_ideas")),
    check("card", "Ideenkarten gezeigt", "Idea cards shown", board.length > 0),
    check("count", `Genau ${count} Ideen`, `Exactly ${count} ideas`, board.length === count, String(board.length)),
    check("cast", "Richtige Figuren", "Right characters", board.length > 0 && castOk >= board.length - 1, `${castOk}/${board.length}`),
    check("new", "Keine vorhandenen Titel", "No existing titles", board.length > 0 && doubles.length === 0, doubles[0]?.title),
    check("noList", "Keine Ideenliste im Text", "No idea list in the text", !/^\s*(\d+[.)]|[-*])\s/m.test(textWithoutDrafts(answerText(r.items)))),
    check("replies", "Antwortvorschläge angeboten", "Offers reply suggestions", replies(r.items).length > 0),
  ];
}

// ------------------------------------------------------------------- tasks

const KRANK_LINE = "Laut Gesetz brauchst du ab dem ersten Tag";
const PAUSE_LINE = "Nach sechs Stunden stehen mir";

function lineIndex(world: World, key: string, start: string): { index: number; text: string } {
  const blocks = world.blocks.get(key) ?? [];
  const index = blocks.findIndex((b) => b.text.includes(start));
  return { index, text: blocks[index]?.text ?? "" };
}

export const TASKS: Task[] = [
  {
    id: "agentz-hook",
    profile: "agentz",
    label: { de: "Einstieg prüfen", en: "Check the opening" },
    conversation: "hook",
    mode: "script",
    script: "krankmeldung",
    phase: 1,
    request: (w) => job(w, "krankmeldung", "hook", "Einstieg prüfen"),
    rubric: "Der Einstieg ist Smalltalk; der Konflikt (Krankmeldung per Sprachnachricht) kommt spät. Gute Vorschläge starten im Konflikt, klingen nach Timo und Axel (Arbeitsplatzsketch: Axel geizig und misstrauisch, Timo schlagfertig) und lassen den Rest stimmig anschließen.",
    checks: (r) => {
      const { p, checks } = cardChecks(r);
      const t = p?.target;
      return [
        ...checks,
        check("start", "Ersetzt den Anfang", "Replaces the opening", !!t && t.mode === "replace" && t.from <= 2),
        check("conflict", "Konfliktstelle markiert", "Marks where the conflict starts", !!p && p.currentConflict !== undefined && p.options.every((o) => o.conflictBlock !== undefined)),
        check("cast", "Nur Timo und Axel", "Only Timo and Axel", !!p && p.options.every((o) => [...speakers(o.blocks)].every((n) => n === "TIMO" || n === "AXEL"))),
      ];
    },
  },
  {
    id: "agentz-cut",
    profile: "agentz",
    label: { de: "Kürzen", en: "Shorten" },
    conversation: "cut",
    mode: "script",
    script: "mitarbeitergespraech",
    phase: 1,
    request: (w) => job(w, "mitarbeitergespraech", "cut", "Kürzen"),
    rubric: "Das Skript ist zu lang für den Zielbereich 0:20-1:30. Gute Kürzungen sind wirklich verschieden, behalten Axels Monolog-Charakter nur dort, wo er trägt, und die Schlusspointe („Ist ja auch schon fünf.“) und Axels Gestammel am Ende.",
    checks: (r, w) => {
      const { p, checks } = cardChecks(r);
      const blocks = w.blocks.get("mitarbeitergespraech") ?? [];
      const wpm = wpmOf(w);
      const before = draftRuntime(blocks, wpm);
      const after = p ? p.options.map((_, i) => draftRuntime(applyOption(blocks, p, i), wpm)) : [];
      const last = blocks.filter((b) => b.type === "dialog").at(-1)?.text ?? "";
      const keeps = p ? p.options.map((_, i) => applyOption(blocks, p, i).some((b) => b.text.includes(last.slice(0, 20)))) : [];
      return [
        ...checks,
        check("shorter", "Jede Option ist kürzer", "Every option is shorter", after.length > 0 && after.every((s) => s < before), after.map(clock).join(" / ") || undefined),
        check("target", "Jede Option im Zielbereich", "Every option within the target", after.length > 0 && after.every((s) => s <= 90), `${clock(before)} → ${after.map(clock).join(" / ")}`),
        check("punchline", "Schlusspointe bleibt", "Keeps the punchline", keeps.length > 0 && keeps.every(Boolean)),
        check("different", "Unterschiedliche Ansätze", "Different approaches", !!p && new Set(p.options.map((o) => o.title.toLowerCase())).size === p.options.length),
      ];
    },
  },
  {
    id: "agentz-ending",
    profile: "agentz",
    label: { de: "Härteres Ende", en: "Harder ending" },
    conversation: "ending",
    mode: "script",
    script: "teambuilding",
    phase: 1,
    request: (w) => job(w, "teambuilding", "ending", "Härteres Ende"),
    rubric: "Das Ende erklärt den Witz („das ist einfach unbezahlte Arbeit …“). Gute Enden zeigen statt erklären, nutzen Axels Gestammel oder einen Callback (Liegestuhl, Pizza, Eigenverantwortung) und treffen den trockenen Ton.",
    checks: (r, w) => {
      const { p, checks } = cardChecks(r);
      const last = (w.blocks.get("teambuilding")?.length ?? 0) - 1;
      const endings = p ? p.options.map((o) => o.blocks.filter((b) => b.type === "dialog").at(-1)?.text ?? "") : [];
      return [
        ...checks,
        // The app's document ends with an empty block; replacing it as well is fine.
        check("end", "Ersetzt den Schluss", "Replaces the closing beat", !!p && p.target.mode === "replace" && p.target.to >= last),
        check("distinct", "Verschiedene letzte Sätze", "Different last lines", endings.length > 1 && new Set(endings).size === endings.length),
        check("noExplain", "Erklärt den Witz nicht mehr", "No longer explains the joke", !!p && p.options.every((o) => !o.blocks.some((b) => /unbezahlte Arbeit/i.test(b.text)))),
      ];
    },
  },
  {
    id: "agentz-voice",
    profile: "agentz",
    label: { de: "Mehr wie Axel (Auswahl)", en: "More like Axel (selection)" },
    conversation: "voice",
    mode: "script",
    script: "personalausweis",
    phase: 1,
    request: (w) => {
      const blocks = w.blocks.get("personalausweis") ?? [];
      const from = 2;
      const to = 19;
      return {
        kind: "chat",
        text: "Mehr wie AXEL",
        quote: { text: blocks.slice(from, to + 1).map((b) => b.text).join("\n\n"), from, to },
        options: { instruction: voiceInstruction("AXEL") },
      };
    },
    rubric: "Axel ist hier Behördenmitarbeiter und spricht im Skript Hochdeutsch. Laut Gedächtnis ist Behörden-Axel genervt, herablassend und berlinert („dit“, „ick“, „wa“, „se“), verweist auf Zuständigkeiten. Gute Optionen treffen genau diese Stimme, ohne den Inhalt oder die Länge stark zu ändern.",
    checks: (r, w) => {
      const { p, checks } = cardChecks(r);
      const selected = (w.blocks.get("personalausweis") ?? []).slice(2, 20);
      const wpm = wpmOf(w);
      const base = draftRuntime(selected, wpm);
      return [
        ...checks,
        check("target", "Ersetzt genau die Auswahl", "Replaces exactly the selection", !!p && p.target.mode === "replace" && p.target.from === 2 && p.target.to === 19, p ? JSON.stringify({ from: (p.target as { from?: number }).from, to: (p.target as { to?: number }).to }) : undefined),
        check("berlin", "Axel berlinert (Gedächtnis genutzt)", "Axel speaks Berlin dialect (uses memory)", !!p && p.options.every((o) => berlinMarkers(linesOf(o.blocks, "AXEL")) >= 2), p ? p.options.map((o) => berlinMarkers(linesOf(o.blocks, "AXEL"))).join(" / ") : undefined),
        check("length", "Länge ähnlich (±35 %)", "Similar length (±35 %)", !!p && p.options.every((o) => Math.abs(draftRuntime(o.blocks, wpm) - base) <= base * 0.35)),
      ];
    },
  },
  {
    id: "agentz-fact",
    profile: "agentz",
    label: { de: "Faktencheck einer Zeile", en: "Fact check of a line" },
    conversation: "fact",
    mode: "claim",
    script: "krankmeldung",
    phase: 1,
    request: (w) => ({ kind: "claim", ...lineIndex(w, "krankmeldung", KRANK_LINE) }),
    rubric: "Richtig ist: Nach § 5 Entgeltfortzahlungsgesetz muss die Arbeitsunfähigkeit spätestens am vierten Tag (nach mehr als drei Kalendertagen) ärztlich bescheinigt werden; der Arbeitgeber darf sie aber schon ab dem ersten Tag verlangen. Die Zeile ist also ungenau bis falsch. Bewerte Richtigkeit, Verständlichkeit, Quellen und ob die Korrektur Axels Ton behält.",
    checks: (r) => factChecks(r, ["imprecise", "wrong"], [/(vier|4\.|drei|3)/i, /(verlang|Arbeitgeber|Chef|fordern|anordnen)/i], /(vier|4\.|drei|3|verlang|darf)/i),
  },
  {
    id: "agentz-remember",
    profile: "agentz",
    label: { de: "„Merk dir das“", en: "“Remember that”" },
    conversation: "remember",
    mode: "script",
    script: "vier-tage",
    phase: 2,
    request: () => ({ kind: "chat", text: "Merk dir bitte: Axel sagt in Chefsketchen nie „Digga“ oder sonstige Jugendsprache, das passt nicht zu ihm." }),
    rubric: "Der Nutzer korrigiert eine dauerhafte Eigenschaft von Axel. Richtig ist ein Gedächtniseintrag für die Figur AXEL im Ordner AgentZ (oder ein passender bestehender Eintrag wird ergänzt), danach eine sehr kurze Bestätigung. Keine Vorschläge, keine langen Erklärungen.",
    checks: (r, w) => {
      // Only this turn's changes (the memory notes in its chat items), not
      // whatever else changed in the world's memory.
      const changed = r.items.flatMap((i) => (i.kind === "memory" ? [i.entry] : []));
      const hit = changed.find((e) => /digga|jugendsprache/i.test(e.content));
      const text = answerText(r.items);
      return [
        check("stored", "Im Gedächtnis gespeichert", "Stored in memory", !!hit, hit?.content.slice(0, 80)),
        check("scope", "Als Figur AXEL im Ordner", "As character AXEL in the folder", !!hit && hit.kind === "character" && hit.subject === "AXEL" && hit.folderId === w.folders.get("agentz"), hit ? `${hit.kind} ${hit.subject ?? ""}` : undefined),
        check("single", "Nur eine Änderung", "Only one change", changed.length === 1, String(changed.length)),
        check("noCards", "Keine Vorschlagskarte", "No option card", proposals(r.items).length === 0),
        check("short", "Kurze Bestätigung", "Short confirmation", text.length > 0 && text.length <= 200, String(text.length)),
      ];
    },
  },
  {
    id: "agentz-ideas",
    profile: "agentz",
    label: { de: "Fünf Ideen (Agent-Modus)", en: "Five ideas (agent mode)" },
    conversation: "session",
    mode: "session",
    folder: "agentz",
    phase: 1,
    request: () => ({ kind: "chat", text: "Gib mir fünf neue Ideen für Behördensketche mit Timo und Axel." }),
    rubric: "Gute Ideen sind echte Behördensatire nach dem Muster des Ordners (alltägliches Anliegen wird zum ausweglosen Regelkreis, Schlusspointe schließt den Kreis), unterschiedlich, in 0:20-1:30 drehbar und wiederholen keine vorhandenen Skripte oder gespeicherten Ideen.",
    checks: (r, w) => ideaChecks(r, w, 5, ["TIMO", "AXEL"]),
  },
  {
    id: "agentz-draft",
    profile: "agentz",
    label: { de: "Entwurf zu Idee 2", en: "Draft of idea 2" },
    conversation: "session",
    mode: "session",
    folder: "agentz",
    phase: 1,
    request: () => ({ kind: "chat", text: "Schreib Nummer 2." }),
    rubric: "Ein Behördensketch-Entwurf zu Idee 2. Er soll klingen wie die Skripte des Ordners: fast nur Dialog, Axel berlinert und verweist auf Zuständigkeiten, Timo fragt logisch nach und wird genervt, Regelkreis mit Schlusspointe (z. B. „Fuck my life“ oder „DER NÄCHSTE BITTE“, aber nicht zwingend). Länge 0:20-1:30.",
    checks: (r, w) => {
      const { draft, checks } = draftChecks(r, w, "agentz", ["TIMO", "AXEL"]);
      return [
        ...checks,
        check("context", "Holt den Schreibkontext", "Gets the writing context", called(r, "get_writing_context")),
        check("read", "Liest Skripte des Ordners", "Reads scripts of the folder", called(r, "read_script")),
        check("berlin", "Axel berlinert", "Axel speaks Berlin dialect", !!draft && berlinMarkers(linesOf(draft.blocks, "AXEL")) >= 3, draft ? String(berlinMarkers(linesOf(draft.blocks, "AXEL"))) : undefined),
      ];
    },
  },
  {
    id: "agentz-revise",
    profile: "agentz",
    label: { de: "Überarbeiten: kürzer, härteres Ende", en: "Revise: shorter, harder ending" },
    conversation: "session",
    mode: "session",
    folder: "agentz",
    phase: 1,
    request: () => ({ kind: "chat", text: "Mach es kürzer und gib ihm ein härteres Ende." }),
    rubric: "Überarbeitung des Entwurfs aus der Runde davor: komplett wiederholt, spürbar kürzer, mit einem härteren Ende. Stimmen und Regelkreis bleiben.",
    checks: (r, w) => {
      const wpm = wpmOf(w);
      const before = draftsOf(r.previousItems, wpm).at(-1);
      const after = draftsOf(r.items, wpm).at(-1);
      const lastLine = (d: Draft | undefined) => d?.blocks.filter((b) => b.type === "dialog").at(-1)?.text ?? "";
      return [
        check("draft", "Neue Version geschrieben", "New version written", !!after),
        check("same", "Gleicher Entwurf (gleiche id)", "Same draft (same id)", !!before && !!after && before.slug === after.slug, after?.slug),
        check("shorter", "Kürzer als vorher", "Shorter than before", !!before && !!after && after.runtimeSec < before.runtimeSec, before && after ? `${clock(before.runtimeSec)} → ${clock(after.runtimeSec)}` : undefined),
        check("complete", "Ganzes Skript wiederholt", "Repeats the whole script", !!before && !!after && after.blocks.length >= before.blocks.length * 0.5),
        check("ending", "Neues Ende", "New ending", !!before && !!after && lastLine(before) !== lastLine(after)),
      ];
    },
  },
  {
    id: "agentz-ad",
    profile: "agentz",
    label: { de: "Werbeclip (Agent-Modus)", en: "Promo clip (agent mode)" },
    conversation: "ad",
    mode: "session",
    folder: "werbung",
    phase: 1,
    request: () => ({ kind: "chat", text: "Schreib einen neuen Werbeclip für die Kanalmitgliedschaft, diesmal mit unserem Merch." }),
    rubric: "Ein Werbeclip im Stil des Ordners Werbung: kurze, abwechselnde Kameraansprache von Timo und Axel, eine Chef-Mitarbeiter-Spitze, direkter Aufruf, Ende mit „Weiter mit dem Video“, 0:10-0:30.",
    checks: (r, w) => {
      const { draft, checks } = draftChecks(r, w, "werbung", ["TIMO", "AXEL"]);
      const last = draft?.blocks.filter((b) => b.type === "dialog").at(-1)?.text ?? "";
      return [
        ...checks,
        check("read", "Liest den bisherigen Werbeclip", "Reads the existing promo", called(r, "read_script")),
        check("outro", "Endet mit „Weiter mit dem Video“", "Ends with “Weiter mit dem Video”", /weiter mit dem video/i.test(last), last.slice(0, 60) || undefined),
      ];
    },
  },
  {
    id: "agentz-learn",
    profile: "agentz",
    label: { de: "Lernen aus fertigem Skript", en: "Learning from a finished script" },
    conversation: "learn",
    mode: "learn",
    script: "fitnessstudio",
    phase: 2,
    request: () => ({ kind: "learn" }),
    rubric: "Das fertige Skript bringt eine neue Figur (PAMPOWSKI, nickt alles mit „Sehr vernünftig“ ab). Das Dienstleister-Muster von Axel steht schon im Gedächtnis. Gut ist: höchstens drei knappe, dauerhafte Einträge, vor allem zur neuen Figur, keine Wiederholung von Bekanntem, keine Handlungszusammenfassung.",
    checks: (r) => {
      const changes = r.memoryChanges ?? [];
      const contents = changes.map((c) => c.entry.content);
      return [
        check("read", "Liest das Skript", "Reads the script", called(r, "read_script")),
        check("max3", "Höchstens drei Änderungen", "At most three changes", changes.length <= 3, String(changes.length)),
        check("newCharacter", "Lernt die neue Figur", "Learns the new character", changes.some((c) => c.entry.subject === "PAMPOWSKI" || /pampowski/i.test(c.entry.content))),
        check("noPlot", "Keine Handlungszusammenfassung", "No plot summary", contents.every((c) => !/fitnessstudio|fax|trainingsplan/i.test(c))),
      ];
    },
  },
  {
    id: "pflege-hook",
    profile: "pflege",
    label: { de: "Einstieg prüfen", en: "Check the opening" },
    conversation: "hook",
    mode: "script",
    script: "pausenregel",
    phase: 1,
    request: (w) => job(w, "pausenregel", "hook", "Einstieg prüfen"),
    rubric: "Der Clip beginnt mit einer Erklärung von Mara. Gute Einstiege starten im Pausenkonflikt mit Dr. Krause, bleiben kurz (0:30-0:45), nie auf Kosten von Patienten, und passen zu Maras trockener Müdigkeit. Ida ist ermutigend und knapp.",
    checks: (r) => {
      const { p, checks } = cardChecks(r);
      return [
        ...checks,
        check("start", "Ersetzt den Anfang", "Replaces the opening", !!p && p.target.mode === "replace" && p.target.from <= 2),
        check("cast", "Nur Mara und Dr. Krause", "Only Mara and Dr. Krause", !!p && p.options.every((o) => [...speakers(o.blocks)].every((n) => n === "MARA" || n === "DR. KRAUSE"))),
      ];
    },
  },
  {
    id: "pflege-fact",
    profile: "pflege",
    label: { de: "Faktencheck einer Zeile", en: "Fact check of a line" },
    conversation: "fact",
    mode: "claim",
    script: "pausenregel",
    phase: 1,
    request: (w) => ({ kind: "claim", ...lineIndex(w, "pausenregel", PAUSE_LINE) }),
    rubric: "Richtig ist: Nach § 4 ArbZG gibt es bei mehr als sechs bis neun Stunden 30 Minuten Pause, erst bei mehr als neun Stunden 45 Minuten. Die Zeile ist falsch (oder ungenau, weil Mara schon neun Stunden im Dienst ist). Bewerte Richtigkeit, Erklärung, Quellen und ob die Korrektur Maras Ton behält.",
    checks: (r) => factChecks(r, ["wrong", "imprecise"], [/30/, /(9|neun)/i], /(30|neun|9)/i),
  },
  {
    id: "pflege-ideas",
    profile: "pflege",
    label: { de: "Fünf Ideen (Agent-Modus)", en: "Five ideas (agent mode)" },
    conversation: "session",
    mode: "session",
    folder: "station",
    phase: 1,
    request: () => ({ kind: "chat", text: "Fünf Ideen für neue Clips mit Dr. Krause, bitte." }),
    rubric: "Gute Ideen ziehen den Humor aus Überlastung und Bürokratie, nie aus Patienten, passen zu Mara und Dr. Krause und sind in 0:30-0:45 drehbar. Keine Wiederholung vorhandener Clips.",
    checks: (r, w) => ideaChecks(r, w, 5, ["MARA", "DR. KRAUSE"]),
  },
  {
    id: "pflege-draft",
    profile: "pflege",
    label: { de: "Entwurf zu Idee 1", en: "Draft of idea 1" },
    conversation: "session",
    mode: "session",
    folder: "station",
    phase: 1,
    request: () => ({ kind: "chat", text: "Schreib Nummer 1." }),
    rubric: "Ein Clip-Entwurf zu Idee 1: kurz (0:30-0:45), Mara trocken und übermüdet, Dr. Krause überheblich und verliert, Ende mit Maras Blick in die Kamera, kein Erklärwitz.",
    checks: (r, w) => {
      const { draft, checks } = draftChecks(r, w, "station", ["MARA", "DR. KRAUSE"]);
      const last = draft?.blocks.at(-1);
      return [
        ...checks,
        check("read", "Liest Skripte des Ordners", "Reads scripts of the folder", called(r, "read_script")),
        check("camera", "Endet mit Blick in die Kamera", "Ends with a look into the camera", !!last && last.type === "action" && /kamera/i.test(last.text)),
      ];
    },
  },
];
