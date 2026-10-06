// Tools of the agent mode (sessions): writing context, idea boards, saving
// ideas on request and quick replies. Drafts need no tool, they stream as
// part of the reply (see drafts.ts). Like all tools, these only change the
// library when the user asked for it; saved ideas carry their session.

import { api } from "../api";
import { scriptStages, stageLabel } from "../stages";
import type { Folder, Idea } from "../types";
import type { IdeaCard, SavedIdeaRef } from "./chats";
import { targetForTool, writingTarget, type Pace } from "./writingContext";
import { fail, obj, ok } from "./toolArgs";
import type { AgentTool, JsonSchema } from "./types";

export interface IdeaBoardRef {
  itemId: string;
  folderId: string | null;
  ideas: IdeaCard[];
  savedIds: (string | null)[];
}

export interface SessionToolHost {
  chatId(): string;
  /** Folder the session works in (picker in the composer). */
  folderId(): string | null;
  pace(): Pace;
  /** Writes the chat row now; saved ideas reference it. */
  ensureStored(): Promise<void>;
  onIdeas(board: { folderId: string | null; ideas: IdeaCard[] }): void;
  /** `board` is set when the saved ideas came from cards of a board. */
  onIdeasSaved(saved: SavedIdeaRef[], folderId: string | null, board: { itemId: string; indices: number[] } | null): void;
  onReplies(replies: string[]): void;
  /** The newest idea board of this session, if any. */
  lastBoard(): IdeaBoardRef | null;
}

const text = (v: unknown, max = 400): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const MAX_IDEAS_PER_BOARD = 12;
export const MAX_REPLIES = 4;

async function folders(): Promise<Folder[]> {
  return api.listFolders().catch(() => [] as Folder[]);
}

/** The folder id if the folder still exists, else null ("no folder"). */
export async function existingFolder(id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await folders()).some((f) => f.id === id) ? id : null;
}

/** Folder by id or (case-insensitive) name; "current" = the session's.
 *  Unlike `tools.resolveFolder`, an empty value also means the session's
 *  folder, and a session folder that no longer exists falls back to "no
 *  folder" instead of failing. */
export async function resolveSessionFolder(raw: unknown, current: string | null): Promise<{ id: string | null; error?: string }> {
  const value = text(raw, 200);
  if (!value || value === "current") return { id: await existingFolder(current) };
  if (value === "none") return { id: null };
  const list = await folders();
  const hit = list.find((f) => f.id === value) ?? list.find((f) => f.name.toLowerCase() === value.toLowerCase());
  return hit ? { id: hit.id } : { id: null, error: `unknown folder: ${value}` };
}

export function parseIdeaCards(raw: unknown): IdeaCard[] {
  if (!Array.isArray(raw)) return [];
  const out: IdeaCard[] = [];
  for (const item of raw.slice(0, MAX_IDEAS_PER_BOARD)) {
    const o = obj(item);
    const title = text(o.title, 120);
    if (!title) continue;
    const characters = Array.isArray(o.characters)
      ? o.characters.map((c) => text(c, 40).toUpperCase()).filter(Boolean).slice(0, 4)
      : [];
    const seconds = typeof o.seconds === "number" && Number.isFinite(o.seconds) && o.seconds > 0
      ? Math.min(3600, Math.round(o.seconds))
      : null;
    out.push({ title, premise: text(o.premise, 400), hook: text(o.hook, 200), characters, seconds });
  }
  return out;
}

export function parseReplies(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const reply = text(item, 80);
    if (!reply || seen.has(reply.toLowerCase())) continue;
    seen.add(reply.toLowerCase());
    out.push(reply);
    if (out.length >= MAX_REPLIES) break;
  }
  return out;
}

/** Notes of an idea saved from a card: premise, hook and cast. */
export function ideaNotes(card: IdeaCard): string {
  return [card.premise, card.hook ? `Hook: ${card.hook}` : "", card.characters.length ? card.characters.join(", ") : ""]
    .filter(Boolean)
    .join("\n\n");
}

const IDEA_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short working title (2-6 words)." },
    premise: { type: "string", description: "One or two sentences: what happens and why it is funny." },
    hook: { type: "string", description: "Optional first line or image that grabs in the first seconds." },
    characters: { type: "array", items: { type: "string" }, description: "Character names (upper case) as used in this folder." },
    seconds: { type: "integer", description: "Estimated runtime in seconds at the user's pace." },
  },
  required: ["title", "premise"],
  additionalProperties: false,
};

export function createSessionTools(host: SessionToolHost): AgentTool[] {
  return [
    {
      name: "get_writing_context",
      description: "Length target, speaking pace and the resulting dialog word budget for a folder (default: the session's folder), plus the production stages. Call this before writing a draft or estimating idea lengths.",
      parameters: {
        type: "object",
        properties: { folder: { type: "string", description: "Folder id or name, 'current' or 'none'." } },
        additionalProperties: false,
      },
      async run(args) {
        const resolved = await resolveSessionFolder(obj(args).folder, host.folderId());
        if (resolved.error) return fail(resolved.error);
        const folder = resolved.id ? (await folders()).find((f) => f.id === resolved.id) ?? null : null;
        const target = writingTarget(folder, host.pace());
        return ok({
          ...targetForTool(target),
          stages: scriptStages().map((stage) => stageLabel(stage.id)),
        });
      },
    },
    {
      name: "list_ideas",
      description: "List saved ideas (id, title, notes, folder). Open ideas by default.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder id or name, 'current' or 'none'. Omit for all folders." },
          include_used: { type: "boolean", description: "Also ideas that already became scripts." },
          query: { type: "string", description: "Optional filter on title and notes." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        let list: Idea[] = await api.listIdeas();
        if (a.folder !== undefined) {
          const resolved = await resolveSessionFolder(a.folder, host.folderId());
          if (resolved.error) return fail(resolved.error);
          list = list.filter((i) => i.folder_id === resolved.id);
        }
        if (a.include_used !== true) list = list.filter((i) => !i.used_at);
        const query = text(a.query, 120).toLowerCase();
        if (query) list = list.filter((i) => `${i.title} ${i.notes}`.toLowerCase().includes(query));
        const byId = new Map((await folders()).map((f) => [f.id, f.name]));
        return ok(list.slice(0, 80).map((i) => ({
          id: i.id,
          title: i.title,
          notes: i.notes.slice(0, 300),
          folder: i.folder_id ? byId.get(i.folder_id) ?? null : null,
          used: !!i.used_at,
        })));
      },
    },
    {
      name: "propose_ideas",
      description: `Show script ideas as numbered cards (1-${MAX_IDEAS_PER_BOARD}) the user can pick, save or turn into a script. Use it whenever you suggest ideas; do not repeat the ideas in your reply. Nothing is saved yet.`,
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder the ideas are for (id or name). Default: the session's folder." },
          ideas: { type: "array", items: IDEA_SCHEMA, description: `1 to ${MAX_IDEAS_PER_BOARD} ideas.` },
        },
        required: ["ideas"],
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const resolved = await resolveSessionFolder(a.folder, host.folderId());
        if (resolved.error) return fail(resolved.error);
        const ideas = parseIdeaCards(a.ideas);
        if (ideas.length === 0) return fail("no usable ideas: each needs a title and a premise");
        host.onIdeas({ folderId: resolved.id, ideas });
        return ok({
          shown: ideas.length,
          numbers: ideas.map((idea, i) => `${i + 1}: ${idea.title}`),
          note: "The user sees the cards with these numbers. Do not repeat them; at most one short sentence.",
        });
      },
    },
    {
      name: "save_ideas",
      description: "Save ideas to the user's idea list, only when the user asks for it. Either card numbers of the newest idea board, or new ideas given directly.",
      parameters: {
        type: "object",
        properties: {
          numbers: { type: "array", items: { type: "integer" }, description: "Card numbers (1-based) of the newest board." },
          ideas: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, notes: { type: "string" } },
              required: ["title"],
              additionalProperties: false,
            },
          },
          folder: { type: "string", description: "Target folder (id or name). Default: the board's or the session's folder." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const board = host.lastBoard();
        const numbers = Array.isArray(a.numbers)
          ? [...new Set(a.numbers.filter((n): n is number => typeof n === "number" && Number.isInteger(n)))]
          : [];
        const direct = Array.isArray(a.ideas)
          ? a.ideas.map((item) => ({ title: text(obj(item).title, 120), notes: typeof obj(item).notes === "string" ? String(obj(item).notes).trim().slice(0, 2000) : "" }))
            .filter((item) => item.title)
            .slice(0, MAX_IDEAS_PER_BOARD)
          : [];
        if (numbers.length === 0 && direct.length === 0) return fail("give card numbers or ideas");
        if (numbers.length && !board) return fail("there is no idea board in this session yet");
        const invalid = numbers.filter((n) => !board || n < 1 || n > board.ideas.length);
        if (invalid.length) return fail(`unknown card numbers: ${invalid.join(", ")}`);
        // A board's folder (null = "no folder") is the default for its cards.
        const fallbackFolder = numbers.length && board ? board.folderId : host.folderId();
        const resolved = a.folder !== undefined ? await resolveSessionFolder(a.folder, host.folderId()) : { id: await existingFolder(fallbackFolder) };
        if ("error" in resolved && resolved.error) return fail(resolved.error);
        await host.ensureStored();
        const saved: SavedIdeaRef[] = [];
        const already: number[] = [];
        const indices: number[] = [];
        try {
          for (const n of numbers) {
            const index = n - 1;
            if (board?.savedIds[index]) { already.push(n); continue; }
            const card = board!.ideas[index];
            const idea = await api.createIdea({ title: card.title, notes: ideaNotes(card), folderId: resolved.id, sourceChatId: host.chatId() });
            saved.push({ ideaId: idea.id, title: idea.title, number: n });
            indices.push(index);
          }
          for (const item of direct) {
            const idea = await api.createIdea({ title: item.title, notes: item.notes, folderId: resolved.id, sourceChatId: host.chatId() });
            saved.push({ ideaId: idea.id, title: idea.title, number: null });
          }
        } finally {
          // What was stored gets its receipt (and undo), even if a later
          // insert failed.
          if (saved.length) host.onIdeasSaved(saved, resolved.id, board && indices.length ? { itemId: board.itemId, indices } : null);
        }
        return ok({
          saved: saved.map((s) => ({ id: s.ideaId, title: s.title, number: s.number })),
          already_saved: already,
          note: "The user sees a receipt with undo. Confirm in one short sentence.",
        });
      },
    },
    {
      name: "suggest_replies",
      description: `Offer 2-${MAX_REPLIES} short next steps the user can click as their reply (in the user's language, max ~6 words each, phrased as the user would say it). Call it at the end of a turn when there are natural next steps.`,
      parameters: {
        type: "object",
        properties: { replies: { type: "array", items: { type: "string" } } },
        required: ["replies"],
        additionalProperties: false,
      },
      async run(args) {
        const replies = parseReplies(obj(args).replies);
        if (replies.length === 0) return fail("no replies");
        host.onReplies(replies);
        return ok({ shown: replies.length });
      },
    },
  ];
}
