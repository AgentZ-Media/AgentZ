// A run as the app's chat would show it: the user's message, progress
// notes, tool and search steps, option cards rendered like the script, the
// fact check card, memory notes, idea cards, drafts and reply chips.

import { parseScript, type Block, type BenchRun, type ChatItem, type Claim, type IdeaCard, type Proposal } from "./data";
import { chatText, esc } from "./format";
import { t, type Key } from "./i18n";

// Character colours as in the app: its default palette
// (modules/scriptz/lib/characterColors.ts), handed out in order of first
// appearance, so a character keeps its colour on every card. Content colours
// are data, like the palette in the app.
const PALETTE = ["#e0791f", "#3a8ed4", "#7a4ad4", "#2fa56b", "#d04141", "#c87b00", "#1a9aa0", "#a855f7", "#d946ef", "#0ea5e9"];
const colors = new Map<string, string>();

export function characterColor(name: string): string {
  const key = name.trim().toUpperCase();
  let color = colors.get(key);
  if (!color) {
    color = PALETTE[colors.size % PALETTE.length];
    colors.set(key, color);
  }
  return color;
}

/** Same rule as the app (lib/tint.ts): a character block has its own
 *  colour, dialog and parenthetical keep the colour of the character above,
 *  an action block ends the speech run. Tinted at 28 % on the paper. */
export function script(blocks: Block[], numbered = false): string {
  let speaker: string | null = null;
  const lines = blocks.map((b, i) => {
    if (b.type === "character") speaker = b.text.trim() ? b.text : null;
    else if (b.type === "action") speaker = null;
    const tint = speaker && b.type !== "action" ? ` style="--char-tint: color-mix(in srgb, ${characterColor(speaker)} 28%, var(--paper))"` : "";
    return `<p class="b-${b.type}"${tint}>${numbered ? `<span class="ln">${i}</span>` : ""}<span class="tint-host">${esc(b.text)}</span></p>`;
  });
  return `<div class="script">${lines.join("")}</div>`;
}

function target(p: Proposal): string {
  const { mode, from, to, block } = p.target;
  if (mode === "replace") return t("replace", { from: from ?? 0, to: to ?? 0 });
  if (mode === "insertAfter") return t("insertAfter", { block: block ?? 0 });
  return t("append");
}

function proposal(p: Proposal): string {
  return `<div class="cards">${p.options.map((o, i) => `
    <article class="card">
      <header><span class="kicker">${esc(t("option", { n: i + 1 }))} · ${esc(target(p))}</span><h4>${esc(o.title)}</h4>${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}</header>
      ${script(o.blocks)}
    </article>`).join("")}</div>`;
}

const VERDICT_KEY: Record<Claim["verdict"], Key> = { correct: "verdict_correct", imprecise: "verdict_imprecise", wrong: "verdict_wrong", unclear: "verdict_unclear" };

export function claimCard(c: Claim): string {
  const sources = c.sources.length
    ? `<div class="sources"><span class="kicker">${esc(t("sources"))}</span><ul>${c.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title || s.url)}</a></li>`).join("")}</ul></div>`
    : "";
  return `
    <article class="card claim">
      <header><span class="verdict v-${c.verdict}">${esc(t(VERDICT_KEY[c.verdict] ?? "verdict_unclear"))}</span></header>
      <blockquote>${esc(c.quote)}</blockquote>
      <p>${esc(c.explanation)}</p>
      ${sources}
      ${c.fix ? `<div class="fix"><span class="kicker">${esc(t("fix"))}</span>${script(c.fix.blocks)}</div>` : ""}
    </article>`;
}

function ideas(board: IdeaCard[]): string {
  return `<ol class="ideas">${board.map((idea) => `
    <li class="card idea">
      <h4>${esc(idea.title)}</h4>
      <p>${esc(idea.premise)}</p>
      ${idea.hook ? `<p class="note"><span class="kicker">${esc(t("hook"))}</span> ${esc(idea.hook)}</p>` : ""}
      ${idea.characters.length ? `<p class="cast">${idea.characters.map((c) => `<span>${esc(c)}</span>`).join("")}</p>` : ""}
    </li>`).join("")}</ol>`;
}

const TOOL_KEY: Record<string, Key> = {
  get_current_script: "tool_get_current_script",
  read_script: "tool_read_script",
  list_scripts: "tool_list_scripts",
  list_folders: "tool_list_folders",
  search_scripts: "tool_search_scripts",
  get_memory: "tool_get_memory",
  remember: "tool_remember",
  update_memory: "tool_update_memory",
  forget_memory: "tool_forget_memory",
  propose_options: "tool_propose_options",
  report_fact_check: "tool_report_fact_check",
  get_writing_context: "tool_get_writing_context",
  list_ideas: "tool_list_ideas",
  propose_ideas: "tool_propose_ideas",
  save_ideas: "tool_save_ideas",
  suggest_replies: "tool_suggest_replies",
};

export const toolLabel = (name: string) => (TOOL_KEY[name] ? t(TOOL_KEY[name]) : name);

/** Assistant text with its draft blocks shown like the draft panel. */
function assistant(text: string, commentary: boolean): string {
  const parts: string[] = [];
  const re = /^[ \t]*:::draft\b([^\n]*)\n([\s\S]*?)^[ \t]*:::[ \t]*$/gm;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const before = text.slice(last, match.index).trim();
    if (before) parts.push(`<p class="${commentary ? "note-text" : ""}">${chatText(before)}</p>`);
    const title = /title="([^"]*)"/.exec(match[1])?.[1] ?? "";
    parts.push(`<article class="card draft"><header><span class="kicker">${esc(t("draft"))}</span><h4>${esc(title)}</h4></header>${script(parseScript(match[2]))}</article>`);
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = text.slice(last).trim();
  if (rest) parts.push(`<p class="${commentary ? "note-text" : ""}">${chatText(rest)}</p>`);
  return parts.join("");
}

const MEMORY_KEY: Record<string, Key> = { added: "memoryAdded", updated: "memoryUpdated", removed: "memoryRemoved" };

function item(i: ChatItem): string {
  switch (i.kind) {
    case "user":
      return `<div class="msg user">${i.quote ? `<blockquote class="quote">${esc(i.quote)}</blockquote>` : ""}<p>${esc(i.text)}</p></div>`;
    case "assistant":
      return `<div class="msg bot${i.commentary ? " commentary" : ""}">${assistant(i.text, !!i.commentary)}</div>`;
    case "thinking":
      return i.text.trim() ? `<details class="thinking"><summary>${esc(t("thinking"))}</summary><p>${esc(i.text)}</p></details>` : "";
    case "tool":
      return `<div class="step">${esc(toolLabel(i.tool))}</div>`;
    case "search":
      return `<div class="step">${esc(t("searching", { query: i.query }))}</div>`;
    case "proposal":
      return proposal(i.proposal);
    case "claims":
      return i.claims.map(claimCard).join("");
    case "memory":
      return `<div class="memory-note"><span class="kicker">${esc(t(MEMORY_KEY[i.action] ?? "memoryUpdated"))}${i.entry.subject ? ` · ${esc(i.entry.subject)}` : ""}</span><p>${esc(i.entry.content)}</p>${i.previous ? `<p class="muted small"><s>${esc(i.previous.content)}</s></p>` : ""}</div>`;
    case "ideas":
      return ideas(i.ideas);
    case "replies":
      return `<div class="chips">${i.replies.map((r) => `<span>${esc(r)}</span>`).join("")}</div>`;
    case "error":
      return `<p class="error">${esc(i.message)}</p>`;
    default:
      return "";
  }
}

export function chat(run: BenchRun): string {
  const parts = run.items.map(item);
  if (run.claim) {
    parts.push(run.claim.claim ? claimCard(run.claim.claim) : `<p class="muted">${esc(t("noClaim"))}</p>`);
    if (run.claim.note) parts.push(`<div class="msg bot"><p>${chatText(run.claim.note)}</p></div>`);
  }
  if (run.memoryChanges && !run.memoryChanges.length) parts.push(`<p class="muted">${esc(t("learnedNothing"))}</p>`);
  return `<div class="chat">${parts.join("")}</div>`;
}
