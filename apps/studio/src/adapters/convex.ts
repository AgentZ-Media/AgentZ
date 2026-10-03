// ConvexStorageAdapter - the StorageAdapter implementation that lets the
// reused core editor read/write scripts against the Convex backend.
//
// The Studio app's own screens (clients, folders, ideas lists, workflow,
// comments) talk to Convex directly via src/lib/convex. This adapter only
// covers what the core editor itself calls: load a script, autosave content,
// character colours, per-device settings/app-state, and export. CRUD that
// Studio drives elsewhere throws a clear error if ever reached.

import {
  setStorageAdapter,
  type StorageAdapter,
  type CreateScriptInput,
  type UpdateScriptInput,
  type ListScriptsQuery,
  type ConvertIdeaInput,
  type CreateIdeaInput,
  type UpdateIdeaInput,
  type ExportPdfRequest,
  type ExportPlaintextRequest,
  type ExportResult,
} from "@scriptz/core/lib/storage";
import type {
  CharacterColorRecord,
  DailyStatsSummary,
  DailyWordEntry,
  Folder,
  Idea,
  Script,
  ScriptCharacter,
  ScriptStatus,
  ScriptSummary,
  SearchHit,
  Snapshot,
  SnapshotMeta,
} from "@scriptz/core/lib/types";
import {
  extractCharacterNames,
  dialogWordsByCharacter,
  extractPlainText,
  extractTeleprompterText,
} from "@scriptz/core/lib/lex";
import { DEFAULT_PALETTE, serializeCharsMeta } from "@scriptz/core/lib/characterColors";
import {
  serializeScriptToBytes,
  defaultScriptzFilename,
  SCRIPTZ_MIME,
  SCRIPTZ_EXTENSION,
} from "@scriptz/core/lib/scriptzFile";
import { getPlatformAdapter } from "@scriptz/core/lib/platform";
import { convex } from "../lib/convex";
import { api } from "../../convex/_generated/api";

const notSupported = (what: string): never => {
  throw new Error(
    `ConvexStorageAdapter: ${what} ist im Studio nicht über den Storage-Adapter verfügbar (läuft direkt über die Convex-API).`,
  );
};

// ---- Current client context (character colours are scoped per client) -----
let currentClientId: string | null = null;
let knownColors: Map<string, string> | null = null;

/** Set the client whose character palette the editor should use. Called when
 *  a script opens (see ScriptEditor). Resets the colour cache on change so a
 *  character name never carries its colour across companies. */
export function setCurrentClient(clientId: string | null): void {
  if (clientId !== currentClientId) {
    currentClientId = clientId;
    knownColors = null;
  }
}

async function ensureKnownColors(): Promise<Map<string, string>> {
  if (knownColors) return knownColors;
  const m = new Map<string, string>();
  if (currentClientId) {
    const recs = (await convex.query(api.characterColors.list, {
      clientId: currentClientId as never,
    })) as CharacterColorRecord[];
    for (const r of recs) {
      const c = r.override_color ?? r.default_color;
      if (c) m.set(r.name.toUpperCase(), c);
    }
  }
  knownColors = m;
  return m;
}

/** Compute the character list (name + colour + dialog share) from the editor
 *  content, assigning + persisting palette colours for new names so the
 *  whole deployment stays consistent. */
async function computeCharacters(contentJson: string): Promise<ScriptCharacter[]> {
  const names = extractCharacterNames(contentJson); // UPPERCASE, in order
  const shares = dialogWordsByCharacter(contentJson); // UPPERCASE keys
  const known = await ensureKnownColors();
  const used = new Set<string>(known.values());
  const total = Object.values(shares).reduce((a, b) => a + b, 0);

  const out: ScriptCharacter[] = [];
  for (const name of names) {
    let color = known.get(name);
    if (!color) {
      color =
        DEFAULT_PALETTE.find((c) => !used.has(c)) ??
        DEFAULT_PALETTE[out.length % DEFAULT_PALETTE.length];
      known.set(name, color);
      used.add(color);
      if (currentClientId)
        void convex
          .mutation(api.characterColors.setColor, {
            clientId: currentClientId as never,
            name,
            color,
          })
          .catch(() => {});
    }
    const words = shares[name] ?? 0;
    const share = total > 0 ? words / total : undefined;
    out.push(share !== undefined ? { name, color, share } : { name, color });
  }
  return out;
}

function countWords(contentJson: string): number {
  const text = extractPlainText(contentJson).trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ---- localStorage-backed per-device prefs ---------------------------------
function lsGet(prefix: string, key: string): string | null {
  try {
    return localStorage.getItem(`studio.${prefix}.${key}`);
  } catch {
    return null;
  }
}
function lsSet(prefix: string, key: string, value: string): void {
  try {
    localStorage.setItem(`studio.${prefix}.${key}`, value);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Maps the Studio approval workflow status onto the core production
 *  stage. Read-only mapping - the Studio workflow stays the source of
 *  truth and is driven via the Convex API (WorkflowBar), never through
 *  `setScriptStatus`. */
function studioStatusToScriptStatus(raw: unknown): ScriptStatus {
  switch (raw) {
    case "approved":
      return "ready";
    case "filmed":
      return "shot";
    // draft / in_review / changes_requested / rejected (and anything
    // unknown) are all still being written.
    default:
      return "writing";
  }
}

class ConvexStorageAdapter implements StorageAdapter {
  // ===== Scripts =====
  async getScript(id: string): Promise<Script> {
    const s = (await convex.query(api.scripts.get, {
      scriptId: id as never,
    })) as unknown as Omit<Script, "status" | "status_changed_at"> & {
      status?: unknown;
    };
    // The Convex payload carries the Studio workflow status
    // (draft/in_review/...) under `status`; core expects a ScriptStatus.
    return {
      ...s,
      status: studioStatusToScriptStatus(s.status),
      status_changed_at: null,
    };
  }

  async updateScript(input: UpdateScriptInput): Promise<ScriptSummary> {
    let characters: ScriptCharacter[] = input.characters ?? [];
    if (input.contentJson !== undefined) {
      characters = await computeCharacters(input.contentJson);
      await convex.mutation(api.scripts.updateContent, {
        scriptId: input.id as never,
        contentJson: input.contentJson,
        charactersMeta: serializeCharsMeta(characters),
        wordCount: countWords(input.contentJson),
      });
    }
    if (input.title !== undefined || input.highlightingEnabled !== undefined) {
      await convex.mutation(api.scripts.updateMeta, {
        scriptId: input.id as never,
        title: input.title,
        highlightingEnabled:
          input.highlightingEnabled === undefined
            ? undefined
            : input.highlightingEnabled === null
              ? null
              : input.highlightingEnabled === 1,
      });
    }
    // The editor's persistence only consumes `characters` from this summary.
    return {
      id: input.id,
      title: input.title ?? "",
      highlighting_enabled: input.highlightingEnabled ?? null,
      created_at: 0,
      updated_at: Date.now(),
      archived_at: null,
      page_count: 1,
      word_count: input.contentJson ? countWords(input.contentJson) : 0,
      dialog_word_count: -1,
      direction_block_count: -1,
      characters,
      folder_id: null,
      status: "writing",
      status_changed_at: null,
    };
  }

  async renameScript(id: string, title: string): Promise<ScriptSummary> {
    await convex.mutation(api.scripts.updateMeta, { scriptId: id as never, title });
    const s = await this.getScript(id);
    return s;
  }

  createScript(_input: CreateScriptInput): Promise<ScriptSummary> {
    return notSupported("createScript");
  }
  listScripts(_query?: ListScriptsQuery): Promise<ScriptSummary[]> {
    return notSupported("listScripts");
  }
  archiveScript(): Promise<void> {
    return notSupported("archiveScript");
  }
  restoreScript(): Promise<void> {
    return notSupported("restoreScript");
  }
  purgeScript(): Promise<void> {
    return notSupported("purgeScript");
  }
  emptyTrash(): Promise<void> {
    return notSupported("emptyTrash");
  }
  duplicateScript(): Promise<ScriptSummary> {
    return notSupported("duplicateScript");
  }
  setScriptStatus(_id: string, _status: ScriptStatus): Promise<ScriptSummary> {
    // Studio has its own approval workflow (WorkflowBar -> Convex).
    return notSupported("setScriptStatus");
  }
  async backfillRuntimeStats(): Promise<void> {
    /* no-op in Studio */
  }

  // ===== Folders ===== (Studio drives these via the Convex API directly)
  listFolders(): Promise<Folder[]> {
    return notSupported("listFolders");
  }
  countLiveScripts(): Promise<number> {
    return notSupported("countLiveScripts");
  }
  createFolder(): Promise<Folder> {
    return notSupported("createFolder");
  }
  renameFolder(): Promise<Folder> {
    return notSupported("renameFolder");
  }
  setFolderLengthRange(): Promise<Folder> {
    return notSupported("setFolderLengthRange");
  }
  deleteFolder(): Promise<void> {
    return notSupported("deleteFolder");
  }
  moveScript(): Promise<void> {
    return notSupported("moveScript");
  }
  moveScripts(): Promise<void> {
    return notSupported("moveScripts");
  }

  // ===== Snapshots ===== (no version history in Studio; auto-snapshot no-op)
  async createSnapshot(scriptId: string, trigger: "auto" | "manual"): Promise<SnapshotMeta> {
    return { id: "", script_id: scriptId, trigger, created_at: Date.now() };
  }
  async listSnapshots(): Promise<SnapshotMeta[]> {
    return [];
  }
  getSnapshot(): Promise<Snapshot> {
    return notSupported("getSnapshot");
  }
  restoreSnapshot(): Promise<void> {
    return notSupported("restoreSnapshot");
  }
  async deleteSnapshot(): Promise<void> {
    /* no-op */
  }

  // ===== Search ===== (Studio uses api.search directly, scoped per client)
  globalSearch(): Promise<SearchHit[]> {
    return notSupported("globalSearch");
  }

  // ===== Settings + App-State (per device, localStorage) =====
  async getSetting(key: string): Promise<string | null> {
    return lsGet("setting", key);
  }
  async setSetting(key: string, value: string): Promise<void> {
    lsSet("setting", key, value);
  }
  async getAppState(key: string): Promise<string | null> {
    return lsGet("appstate", key);
  }
  async setAppState(key: string, value: string): Promise<void> {
    lsSet("appstate", key, value);
  }

  // ===== Character colours =====
  async listCharacterColors(): Promise<CharacterColorRecord[]> {
    if (!currentClientId) return [];
    return (await convex.query(api.characterColors.list, {
      clientId: currentClientId as never,
    })) as CharacterColorRecord[];
  }
  async setCharacterColor(name: string, color: string): Promise<string[]> {
    if (!currentClientId) return [];
    const up = name.toUpperCase();
    await convex.mutation(api.characterColors.setColor, {
      clientId: currentClientId as never,
      name: up,
      color,
    });
    if (knownColors) knownColors.set(up, color);
    return [];
  }
  async clearCharacterColor(): Promise<string[]> {
    return [];
  }

  // ===== Export =====
  async exportPdf(input: ExportPdfRequest): Promise<ExportResult> {
    const s = await this.getScript(input.scriptId);
    const { buildPdfBytes } = await import("@scriptz/core/lib/exportPdf");
    const bytes = await buildPdfBytes(
      { title: s.title, contentJson: s.content_json, characters: s.characters ?? [] },
      {
        includeHighlighting: input.includeHighlighting,
        includeTitlePage: input.includeTitlePage,
      },
    );
    return getPlatformAdapter().saveAs(
      {
        suggestedName: `${s.title || "Skript"}.pdf`,
        mimeType: "application/pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      },
      bytes,
    );
  }
  async exportPlaintext(input: ExportPlaintextRequest): Promise<ExportResult> {
    const s = await this.getScript(input.scriptId);
    const bytes = new TextEncoder().encode(extractTeleprompterText(s.content_json));
    return getPlatformAdapter().saveAs(
      {
        suggestedName: `${s.title || "Skript"}.txt`,
        mimeType: "text/plain;charset=utf-8",
        filters: [{ name: "Plain Text", extensions: ["txt"] }],
      },
      bytes,
    );
  }
  async exportScriptz(scriptId: string): Promise<ExportResult> {
    const s = await this.getScript(scriptId);
    const bytes = serializeScriptToBytes({
      title: s.title,
      content_json: s.content_json,
      characters: s.characters ?? [],
      highlighting_enabled: s.highlighting_enabled,
      created_at: s.created_at,
      updated_at: s.updated_at,
      status: s.status,
    });
    return getPlatformAdapter().saveAs(
      {
        suggestedName: defaultScriptzFilename(s.title),
        mimeType: SCRIPTZ_MIME,
        filters: [{ name: "ScriptZ-Datei", extensions: [SCRIPTZ_EXTENSION] }],
      },
      bytes,
    );
  }
  async importScriptz(): Promise<{ scriptId: string; title: string } | null> {
    return null;
  }

  // ===== Ideas ===== (Studio drives these via the Convex API directly)
  listIdeas(): Promise<Idea[]> {
    return notSupported("listIdeas");
  }
  createIdea(_input: CreateIdeaInput): Promise<Idea> {
    return notSupported("createIdea");
  }
  updateIdea(_input: UpdateIdeaInput): Promise<Idea> {
    return notSupported("updateIdea");
  }
  deleteIdea(): Promise<void> {
    return notSupported("deleteIdea");
  }
  moveIdea(): Promise<void> {
    return notSupported("moveIdea");
  }
  convertIdeaToScript(
    _input: ConvertIdeaInput,
  ): Promise<{ idea: Idea; script: ScriptSummary }> {
    return notSupported("convertIdeaToScript");
  }

  // ===== Stats ===== (not surfaced in Studio)
  async loadDailyWords(): Promise<DailyWordEntry[]> {
    return [];
  }
  async loadDailyStats(): Promise<DailyStatsSummary> {
    return {
      wordsToday: 0,
      wordsThisWeek: 0,
      streakDays: 0,
      dailyWords: [],
      activeDays: 0,
      totalWords: 0,
    };
  }
}

export const convexStorageAdapter = new ConvexStorageAdapter();
setStorageAdapter(convexStorageAdapter);
