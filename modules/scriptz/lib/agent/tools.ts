// The agent's tools. Provider-neutral: each tool is a JSON schema plus a
// handler; the provider (Codex) only forwards calls. The agent has access to
// everything (all scripts, folders, memory); web search is the provider's
// own built-in tool.

import { api } from "../api";
import { scriptStages, stageLabel, isFinalStage } from "../stages";
import type { Folder } from "../types";
import {
  addMemory,
  deleteMemory,
  getMemoryEntry,
  listMemory,
  MemoryFullError,
  normalizeCharacter,
  relationSubject,
  updateMemory,
  type MemoryEntry,
  type MemoryKind,
  type MemorySource,
} from "./memory";
import { anchorTarget, parseClaims, parseProposal, type Claim, type Proposal } from "./proposals";
import { blocksFromContent, charactersIn, numberedScript, type AgentBlock } from "./scriptText";
import type { AgentTool, JsonSchema, ToolResult } from "./types";

export type MemoryChange =
  | { action: "added"; entry: MemoryEntry }
  | { action: "updated"; entry: MemoryEntry; previous: MemoryEntry }
  | { action: "removed"; entry: MemoryEntry };

export interface ToolHost {
  /** The script the chat belongs to (null outside a script). */
  scriptId: string | null;
  /** Live blocks of the open editor (includes unsaved typing). */
  liveBlocks(): AgentBlock[] | null;
  /** Current selection in block indices, if any. */
  selection(): { from: number; to: number; text: string } | null;
  onProposal(proposal: Proposal): void;
  onClaims(claims: Claim[]): void;
  onMemory(change: MemoryChange): void;
  memorySource: MemorySource;
  memorySourceScriptId: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const text = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

const ok = (value: unknown): ToolResult => ({ ok: true, output: typeof value === "string" ? value : JSON.stringify(value) });
const fail = (message: string): ToolResult => ({ ok: false, output: JSON.stringify({ error: message }) });

async function foldersById(): Promise<Map<string, Folder>> {
  const list = await api.listFolders().catch(() => [] as Folder[]);
  return new Map(list.map((f) => [f.id, f]));
}

async function resolveFolder(raw: unknown, currentFolderId: string | null): Promise<{ id: string | null; error?: string }> {
  const value = text(raw, 200);
  if (!value || value === "none") return { id: null };
  if (value === "current") return currentFolderId ? { id: currentFolderId } : { id: null, error: "the current script has no folder" };
  const folders = await foldersById();
  if (folders.has(value)) return { id: value };
  const byName = [...folders.values()].find((f) => f.name.toLowerCase() === value.toLowerCase());
  return byName ? { id: byName.id } : { id: null, error: `unknown folder: ${value}` };
}

function describeEntry(entry: MemoryEntry, folders: Map<string, Folder>) {
  return {
    id: entry.id,
    scope: entry.kind,
    folder: entry.folderId ? folders.get(entry.folderId)?.name ?? entry.folderId : null,
    subject: entry.subject,
    text: entry.content,
  };
}

const BLOCK_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["action", "character", "dialog", "parenthetical"] },
    text: { type: "string", description: "Block text. character = the name only. parenthetical like (whispers)." },
  },
  required: ["type", "text"],
  additionalProperties: false,
};

const TARGET_SCHEMA: JsonSchema = {
  type: "object",
  description: "Where the blocks go. Indices refer to the [n] numbers of the current script.",
  properties: {
    mode: { type: "string", enum: ["append", "insert_after", "replace"] },
    block: { type: "integer", description: "insert_after: insert after this block." },
    from: { type: "integer", description: "replace: first block to replace." },
    to: { type: "integer", description: "replace: last block to replace (inclusive)." },
  },
  required: ["mode"],
  additionalProperties: false,
};

export function createChatTools(host: ToolHost): AgentTool[] {
  // Block texts of the open script as the model last saw them. Its [n]
  // indices refer to this state, so targets are anchored here, not to the
  // live editor (the user may have typed since).
  let shown: string[] | null = null;
  const shownTexts = () => shown ?? (host.liveBlocks() ?? []).map((b) => b.text);

  const currentScript = async () => {
    if (!host.scriptId) return null;
    const script = await api.getScript(host.scriptId);
    const blocks = host.liveBlocks() ?? blocksFromContent(script.content_json);
    shown = blocks.map((b) => b.text);
    return { script, blocks };
  };

  const tools: AgentTool[] = [
    {
      name: "get_current_script",
      description: "Read the script the user has open right now (numbered blocks, folder, stage, characters, selection). Call this before proposing changes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        const current = await currentScript();
        if (!current) return fail("no script is open");
        const folders = await foldersById();
        const { script, blocks } = current;
        return ok({
          id: script.id,
          title: script.title,
          folder: script.folder_id ? folders.get(script.folder_id)?.name ?? null : null,
          folder_id: script.folder_id,
          stage: stageLabel(script.status),
          finished: isFinalStage(script.status),
          characters: charactersIn(blocks),
          block_count: blocks.length,
          selection: host.selection(),
          script: numberedScript(blocks),
        });
      },
    },
    {
      name: "list_folders",
      description: "List all folders (id, name, number of scripts).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async run() {
        const folders = await api.listFolders();
        return ok(folders.map((f) => ({ id: f.id, name: f.name, scripts: f.script_count })));
      },
    },
    {
      name: "list_scripts",
      description: "List scripts, optionally only one folder or matching a title query. Returns id, title, folder, stage, characters.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder id or name, 'current' or 'none' (scripts without folder). Omit for all." },
          query: { type: "string", description: "Optional title filter." },
          limit: { type: "integer", description: "Max results, default 40." },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const current = host.scriptId ? await api.getScript(host.scriptId).catch(() => null) : null;
        let folderId: string | null | undefined;
        if (a.folder !== undefined) {
          const raw = text(a.folder, 200);
          if (raw === "none") folderId = "__inbox__";
          else {
            const resolved = await resolveFolder(raw, current?.folder_id ?? null);
            if (resolved.error) return fail(resolved.error);
            folderId = resolved.id;
          }
        }
        const limit = typeof a.limit === "number" ? Math.max(1, Math.min(200, Math.round(a.limit))) : 40;
        const list = await api.listScripts({ folderId, query: text(a.query, 200) || undefined, limit, sort: "updated" });
        const folders = await foldersById();
        return ok(list.map((s) => ({
          id: s.id,
          title: s.title,
          folder: s.folder_id ? folders.get(s.folder_id)?.name ?? null : null,
          stage: stageLabel(s.status),
          finished: isFinalStage(s.status),
          characters: s.characters.map((c) => c.name),
          words: Math.max(0, s.word_count),
        })));
      },
    },
    {
      name: "read_script",
      description: "Read any script by id (numbered blocks).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async run(args) {
        const id = text(obj(args).id, 100);
        if (!id) return fail("id is required");
        const script = await api.getScript(id).catch(() => null);
        if (!script) return fail(`unknown script: ${id}`);
        const folders = await foldersById();
        const blocks = id === host.scriptId ? host.liveBlocks() ?? blocksFromContent(script.content_json) : blocksFromContent(script.content_json);
        if (id === host.scriptId) shown = blocks.map((b) => b.text);
        return ok({
          id: script.id,
          title: script.title,
          folder: script.folder_id ? folders.get(script.folder_id)?.name ?? null : null,
          stage: stageLabel(script.status),
          script: numberedScript(blocks),
        });
      },
    },
    {
      name: "search_scripts",
      description: "Full-text search across all scripts. Returns matching scripts with a text snippet.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      async run(args) {
        const query = text(obj(args).query, 200);
        if (!query) return fail("query is required");
        const hits = await api.globalSearch(query, 20);
        return ok(hits.map((h) => ({ id: h.id, title: h.title, snippet: h.snippet.replace(/<\/?mark>/g, "") })));
      },
    },
    ...createMemoryTools(host),
    {
      name: "propose_options",
      description: "Show 1-3 alternative script passages to the user as clickable cards rendered like the script. The user decides what gets inserted; never claim you changed the script. Use it whenever you suggest concrete script text.",
      parameters: {
        type: "object",
        properties: {
          target: TARGET_SCHEMA,
          options: {
            type: "array",
            description: "1 to 3 alternatives.",
            items: {
              type: "object",
              properties: {
                title: { type: "string", description: "Short label, e.g. 'Kamerablick'." },
                note: { type: "string", description: "Optional one-line reason." },
                blocks: { type: "array", items: BLOCK_SCHEMA },
                conflict_block: { type: "integer", description: "Opening checks only: 0-based index within this option's blocks where the conflict becomes clear." },
              },
              required: ["title", "blocks"],
              additionalProperties: false,
            },
          },
          current_conflict_block: { type: "integer", description: "Opening checks only: [n] index of the block where the conflict becomes clear in the current script." },
        },
        required: ["target", "options"],
        additionalProperties: false,
      },
      async run(args) {
        const texts = shownTexts();
        const parsed = parseProposal(args, texts.length);
        if (!parsed) return fail("no usable options: each option needs typed blocks, and block indices must exist in the script (call get_current_script again)");
        const proposal = { ...parsed, target: anchorTarget(parsed.target, texts) };
        host.onProposal(proposal);
        return ok({ shown: proposal.options.length, note: "The user sees the options and decides. Do not repeat them in your reply." });
      },
    },
    {
      name: "report_fact_check",
      description: "Show the result of a fact check as a list of real-world claims with verdict, explanation and sources (from web search). Verdicts: correct = holds up; imprecise = basically right but needs nuance; wrong = does not hold up; unclear = sources disagree or are missing. Only for checkable real-world claims, never for events inside the fiction. Optionally include a corrected wording that keeps the joke.",
      parameters: {
        type: "object",
        properties: {
          claims: {
            type: "array",
            items: {
              type: "object",
              properties: {
                quote: { type: "string", description: "The checked statement, quoted from the script." },
                verdict: { type: "string", enum: ["correct", "imprecise", "wrong", "unclear"] },
                explanation: { type: "string", description: "1-3 plain sentences for the writer. Do not repeat the verdict name." },
                sources: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { title: { type: "string" }, url: { type: "string" } },
                    required: ["url"],
                    additionalProperties: false,
                  },
                },
                fix: {
                  type: "object",
                  properties: { target: TARGET_SCHEMA, blocks: { type: "array", items: BLOCK_SCHEMA } },
                  required: ["target", "blocks"],
                  additionalProperties: false,
                },
              },
              required: ["quote", "verdict", "explanation"],
              additionalProperties: false,
            },
          },
        },
        required: ["claims"],
        additionalProperties: false,
      },
      async run(args) {
        const texts = shownTexts();
        const claims = parseClaims(args, texts.length).map((claim) => (
          claim.fix ? { ...claim, fix: { ...claim.fix, target: anchorTarget(claim.fix.target, texts) } } : claim
        ));
        if (claims.length === 0) return fail("no usable claims");
        host.onClaims(claims);
        return ok({ shown: claims.length, note: "The user sees the fact check. Keep your reply to one or two sentences." });
      },
    },
  ];
  return tools;
}

export function createMemoryTools(host: Pick<ToolHost, "scriptId" | "onMemory" | "memorySource" | "memorySourceScriptId">): AgentTool[] {
  const currentFolder = async () => {
    if (!host.scriptId) return null;
    return (await api.getScript(host.scriptId).catch(() => null))?.folder_id ?? null;
  };
  return [
    {
      name: "get_memory",
      description: "Read stored memory. Without arguments: everything. Use it to see entries of other folders or to find ids before updating.",
      parameters: {
        type: "object",
        properties: {
          folder: { type: "string", description: "Folder id or name, or 'current'." },
          character: { type: "string" },
        },
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const folders = await foldersById();
        let entries = await listMemory();
        if (a.folder !== undefined) {
          const resolved = await resolveFolder(a.folder, await currentFolder());
          if (resolved.error) return fail(resolved.error);
          entries = entries.filter((e) => e.kind === "global" || e.folderId === resolved.id || e.folderId === null);
        }
        const character = text(a.character, 80);
        if (character) {
          const name = normalizeCharacter(character);
          entries = entries.filter((e) => e.subject === name || (e.kind === "relation" && e.subject?.split("|").includes(name)));
        }
        return ok(entries.map((e) => describeEntry(e, folders)));
      },
    },
    {
      name: "remember",
      description: "Store one short, durable fact. Scopes: global (the user's general preferences, e.g. 'endings always hard'), folder (tone/world/patterns of a folder), character (a person; folder 'none' = base profile valid everywhere, otherwise that folder's version), relation (how two characters interact). One fact per call, max ~300 chars, lessons not logs. Check existing memory first and update instead of duplicating.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["global", "folder", "character", "relation"] },
          folder: { type: "string", description: "Folder id or name, 'current' or 'none'. Required for folder scope." },
          character: { type: "string", description: "character / relation scope: the (first) character." },
          other_character: { type: "string", description: "relation scope: the second character." },
          text: { type: "string" },
        },
        required: ["scope", "text"],
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const scope = text(a.scope, 20) as MemoryKind;
        if (!["global", "folder", "character", "relation"].includes(scope)) return fail("unknown scope");
        let folderId: string | null = null;
        let subject: string | null = null;
        if (scope !== "global") {
          const resolved = await resolveFolder(a.folder ?? (scope === "folder" ? "current" : "none"), await currentFolder());
          if (resolved.error) return fail(resolved.error);
          folderId = resolved.id;
          if (scope === "folder" && !folderId) return fail("folder scope needs a folder");
        }
        if (scope === "character") {
          subject = normalizeCharacter(text(a.character, 80));
          if (!subject) return fail("character is required");
        }
        if (scope === "relation") {
          const first = text(a.character, 80);
          const second = text(a.other_character, 80);
          if (!first || !second) return fail("relation needs character and other_character");
          subject = relationSubject(first, second);
        }
        try {
          const entry = await addMemory({
            kind: scope, folderId, subject, content: text(a.text, 600),
            source: host.memorySource, sourceScriptId: host.memorySourceScriptId,
          });
          host.onMemory({ action: "added", entry });
          return ok({ id: entry.id, stored: entry.content });
        } catch (error) {
          if (error instanceof MemoryFullError) return fail("this memory scope is full: merge or remove entries first (update_memory / forget_memory)");
          return fail(error instanceof Error ? error.message : String(error));
        }
      },
    },
    {
      name: "update_memory",
      description: "Rewrite an existing memory entry (merge, correct, sharpen).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
      async run(args) {
        const a = obj(args);
        const previous = await getMemoryEntry(text(a.id, 100));
        if (!previous) return fail("unknown memory id");
        const entry = await updateMemory(previous.id, text(a.text, 600));
        host.onMemory({ action: "updated", entry, previous });
        return ok({ id: entry.id, stored: entry.content });
      },
    },
    {
      name: "forget_memory",
      description: "Delete a memory entry that is wrong or outdated.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async run(args) {
        const entry = await getMemoryEntry(text(obj(args).id, 100));
        if (!entry) return fail("unknown memory id");
        await deleteMemory(entry.id);
        host.onMemory({ action: "removed", entry });
        return ok({ removed: entry.id });
      },
    },
  ];
}

/** Stage names in order, for the system prompt. */
export function stageNames(): string[] {
  return scriptStages().map((stage) => stageLabel(stage.id));
}
