import {
  clearCharacterColor as ccClear,
  listCharacterColors as ccList,
  setCharacterColor as ccSet,
} from "./characterColors";
import { sqlAgentStorage } from "./agent/sqlStorage";
import { sqlLocalChanges } from "./localChanges/sql";

// Public host contract (package export @agentz/scriptz/storage).
export { getStorageAdapter, setStorageAdapter } from "./storage";
export type { ScriptzStorage } from "./storage";
export type { AgentStorage } from "./agent/storage";
export type { LocalChange, LocalChangePage, LocalChangeStore } from "./localChanges/types";
import {
  findUnusedCharacterNames as cuFindUnused,
  pruneUnusedCharacterNames as cuPruneUnused,
} from "./characterUsage";
import { extractTeleprompterText } from "./lex";
import { getPlatformAdapter } from "@agentz/kit/platform";
import {
  defaultScriptzFilename,
  parseScriptzBytes,
  SCRIPTZ_EXTENSION,
  SCRIPTZ_MIME,
  serializeScriptToBytes,
} from "./scriptzFile";
import {
  getStorageAdapter,
  setStorageAdapter,
  type ExportResult,
  type ScriptzStorage,
} from "./storage";
import {
  countLiveScripts as foldersCountLive,
  createFolder as foldersCreate,
  deleteFolder as foldersDelete,
  listFolders as foldersList,
  moveScript as foldersMoveScript,
  moveScripts as foldersMoveScripts,
  renameFolder as foldersRename,
  setFolderLengthRange as foldersSetLengthRange,
} from "./folders";
import {
  convertIdeaToScript as ideasConvert,
  createIdea as ideasCreate,
  markIdeaUsed as ideasMarkUsed,
  deleteIdea as ideasDelete,
  restoreIdea as ideasRestore,
  listIdeas as ideasList,
  moveIdea as ideasMove,
  updateIdea as ideasUpdate,
} from "./ideas";
import {
  loadDailyWords as dwLoadEntries,
  loadStats as dwLoadStats,
} from "./dailyWords";
import { globalSearch as searchGlobal } from "./search";
import { isKnownStage } from "./stages";
import { t } from "../i18n";
import {
  archiveScript as scriptsArchive,
  backfillRuntimeStats as scriptsBackfillRuntime,
  createScript as scriptsCreate,
  duplicateScript as scriptsDuplicate,
  emptyTrash as scriptsEmptyTrash,
  getScript as scriptsGet,
  listScripts as scriptsList,
  purgeScript as scriptsPurge,
  renameScript as scriptsRename,
  restoreScript as scriptsRestore,
  setScriptStatus as scriptsSetStatus,
  countScriptsWithStatus as scriptsCountWithStatus,
  reassignScriptStatus as scriptsReassignStatus,
  updateScript as scriptsUpdate,
} from "./scripts";
import {
  createSnapshot as snapsCreate,
  deleteSnapshot as snapsDelete,
  getSnapshot as snapsGet,
  listSnapshots as snapsList,
  restoreSnapshot as snapsRestore,
} from "./snapshots";
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
} from "./types";

// SQL-based product storage. Shared key-value storage lives in Kit. The lib/*
// modules access the host database via DbConnection (see @agentz/kit/platform).
// Registered explicitly by the host; the `api` proxy reads the active
// adapter on every call, so hosts can replace storage without changing callers.
const sqlBackedAdapter: ScriptzStorage = {
  agent: sqlAgentStorage,
  localChanges: sqlLocalChanges,
  // Scripts
  async createScript(input: {
    title?: string;
    initialContentJson?: string;
    folderId?: string | null;
  }): Promise<ScriptSummary> {
    return scriptsCreate(
      input.title ?? null,
      input.initialContentJson ?? null,
      input.folderId ?? null,
    );
  },
  async getScript(id: string): Promise<Script> {
    return scriptsGet(id);
  },
  async updateScript(input: {
    id: string;
    title?: string;
    highlightingEnabled?: number | null;
    contentJson?: string;
    characters?: ScriptCharacter[];
    internalRewrite?: boolean;
  }): Promise<ScriptSummary> {
    return scriptsUpdate(input);
  },
  async listScripts(query: {
    includeArchived?: boolean;
    onlyArchived?: boolean;
    sort?: "updated" | "created" | "title";
    query?: string;
    limit?: number;
    offset?: number;
    folderId?: string | null;
    status?: ScriptStatus;
  } = {}): Promise<ScriptSummary[]> {
    return scriptsList({
      includeArchived: query.includeArchived ?? null,
      onlyArchived: query.onlyArchived ?? null,
      sort: query.sort ?? null,
      query: query.query ?? null,
      limit: query.limit ?? null,
      offset: query.offset ?? null,
      folderId: query.folderId ?? null,
      status: query.status ?? null,
    });
  },
  async archiveScript(id: string): Promise<void> {
    return scriptsArchive(id);
  },
  async restoreScript(id: string): Promise<void> {
    return scriptsRestore(id);
  },
  async purgeScript(id: string): Promise<void> {
    return scriptsPurge(id);
  },
  async emptyTrash(): Promise<void> {
    return scriptsEmptyTrash();
  },
  async duplicateScript(id: string): Promise<ScriptSummary> {
    return scriptsDuplicate(id);
  },
  async renameScript(id: string, title: string): Promise<ScriptSummary> {
    return scriptsRename(id, title);
  },
  async setScriptStatus(id: string, status: ScriptStatus): Promise<ScriptSummary> {
    return scriptsSetStatus(id, status);
  },
  async countScriptsWithStatus(status: ScriptStatus): Promise<number> {
    return scriptsCountWithStatus(status);
  },
  async reassignScriptStatus(from: ScriptStatus, to: ScriptStatus): Promise<number> {
    return scriptsReassignStatus(from, to);
  },
  async backfillRuntimeStats(): Promise<void> {
    return scriptsBackfillRuntime();
  },

  // Folders
  async listFolders(): Promise<Folder[]> {
    return foldersList();
  },
  async countLiveScripts(): Promise<number> {
    return foldersCountLive();
  },
  async createFolder(name: string): Promise<Folder> {
    return foldersCreate(name);
  },
  async renameFolder(id: string, name: string): Promise<Folder> {
    return foldersRename(id, name);
  },
  async setFolderLengthRange(
    id: string,
    minSec: number | null,
    maxSec: number | null,
  ): Promise<Folder> {
    return foldersSetLengthRange(id, minSec, maxSec);
  },
  async deleteFolder(id: string): Promise<void> {
    return foldersDelete(id);
  },
  async moveScript(scriptId: string, folderId: string | null): Promise<void> {
    return foldersMoveScript(scriptId, folderId);
  },
  async moveScripts(scriptIds: string[], folderId: string | null): Promise<void> {
    return foldersMoveScripts(scriptIds, folderId);
  },

  // Snapshots
  async createSnapshot(scriptId: string, trigger: "auto" | "manual"): Promise<SnapshotMeta> {
    return snapsCreate(scriptId, trigger);
  },
  async listSnapshots(scriptId: string): Promise<SnapshotMeta[]> {
    return snapsList(scriptId);
  },
  async getSnapshot(id: string): Promise<Snapshot> {
    return snapsGet(id);
  },
  async restoreSnapshot(snapshotId: string): Promise<void> {
    return snapsRestore(snapshotId);
  },
  async deleteSnapshot(id: string): Promise<void> {
    return snapsDelete(id);
  },

  // Search
  async globalSearch(query: string, limit = 50): Promise<SearchHit[]> {
    return searchGlobal(query, limit);
  },

  // Character-colour records (app-wide)
  async listCharacterColors(): Promise<CharacterColorRecord[]> {
    return ccList();
  },
  async setCharacterColor(name: string, color: string): Promise<string[]> {
    return ccSet(name, color);
  },
  /** Clear the manual override and fall back to the recorded default. The
   * `activeScriptId` is the palette context used when no default has been
   * recorded yet - so the freshly-picked colour avoids colliding with
   * other characters in the script the writer is currently looking at. */
  async clearCharacterColor(
    name: string,
    activeScriptId?: string,
  ): Promise<string[]> {
    return ccClear(name, activeScriptId ?? null);
  },
  async findUnusedCharacterNames(): Promise<string[]> {
    return cuFindUnused();
  },
  async pruneUnusedCharacterNames(only?: string[]): Promise<string[]> {
    return cuPruneUnused(only);
  },

  // Export: PDF bytes via pdf-lib (./exportPdf.ts), plaintext via
  // extractTeleprompterText; the platform adapter writes the bytes.
  async exportPdf(input: {
    scriptId: string;
    includeHighlighting: boolean;
    includeTitlePage: boolean;
    /** Detail line of the title page (lib/pdfDetails.ts). */
    titleDetails?: string | null;
  }): Promise<ExportResult> {
    const s = await scriptsGet(input.scriptId);
    // pdf-lib + fontkit are a ~1 MB bundle - lazy-load so the
    // app start isn't burdened with it. Only users who actually
    // export PDF pay the roundtrip, once.
    const { buildPdfBytes } = await import("./exportPdf");
    const bytes = await buildPdfBytes(
      {
        title: s.title,
        contentJson: s.content_json,
        characters: s.characters ?? [],
      },
      {
        includeHighlighting: input.includeHighlighting,
        includeTitlePage: input.includeTitlePage,
        titleDetails: input.titleDetails ?? null,
      },
    );
    return getPlatformAdapter().saveAs(
      {
        suggestedName: `${s.title || t("common.untitled")}.pdf`,
        mimeType: "application/pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      },
      bytes,
    );
  },
  async exportPlaintext(input: { scriptId: string }): Promise<ExportResult> {
    const s = await scriptsGet(input.scriptId);
    const text = extractTeleprompterText(s.content_json);
    const bytes = new TextEncoder().encode(text);
    return getPlatformAdapter().saveAs(
      {
        suggestedName: `${s.title || t("common.untitled")}.txt`,
        mimeType: "text/plain;charset=utf-8",
        filters: [{ name: "Plain Text", extensions: ["txt"] }],
      },
      bytes,
    );
  },

  // .scriptz container. Pure function for serialization
  // sits in ./scriptzFile.ts; here only the "load script -> bytes -> saveAs"
  // composition. Importer counterpart see importScriptz below.
  async exportScriptz(scriptId: string): Promise<ExportResult> {
    const s = await scriptsGet(scriptId);
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
        filters: [{ name: t("browser.fileType"), extensions: [SCRIPTZ_EXTENSION] }],
      },
      bytes,
    );
  },

  async importScriptz(): Promise<{ scriptId: string; title: string } | null> {
    const file = await getPlatformAdapter().openFile(
      `.${SCRIPTZ_EXTENSION},${SCRIPTZ_MIME}`,
    );
    if (!file) return null;
    const parsed = parseScriptzBytes(file.bytes);
    // contentJson comes back as an object (no double-stringify in the
    // format); we pack it back into a string for createScript -
    // the scripts table holds it as TEXT.
    // createScript normalizes retired block types in the imported content.
    const created = await scriptsCreate(
      parsed.script.title,
      JSON.stringify(parsed.script.contentJson),
      null,
    );
    // Carry the production stage over when this install has it (new
    // scripts start at the first stage).
    if (isKnownStage(parsed.script.status) && parsed.script.status !== created.status) {
      await scriptsSetStatus(created.id, parsed.script.status);
    }
    return { scriptId: created.id, title: created.title };
  },

  // Ideas inbox - standalone table, no contact with the script CRUD.
  async listIdeas(): Promise<Idea[]> {
    return ideasList();
  },
  async createIdea(input: { title: string; notes?: string; folderId?: string | null; sourceChatId?: string | null }): Promise<Idea> {
    return ideasCreate(input);
  },
  async markIdeaUsed(ideaId: string, scriptId: string): Promise<boolean> {
    return ideasMarkUsed(ideaId, scriptId);
  },
  async updateIdea(input: { id: string; title?: string; notes?: string }): Promise<Idea> {
    return ideasUpdate(input);
  },
  async deleteIdea(id: string): Promise<void> {
    return ideasDelete(id);
  },
  async restoreIdea(idea: Idea): Promise<void> {
    return ideasRestore(idea);
  },
  async moveIdea(ideaId: string, folderId: string | null): Promise<void> {
    return ideasMove(ideaId, folderId);
  },
  async convertIdeaToScript(input: {
    ideaId: string;
    folderId?: string | null;
    notesAsAction?: boolean;
  }): Promise<{ idea: Idea; script: ScriptSummary }> {
    return ideasConvert(input);
  },

  // Daily writing statistics (streak / heatmap / daily goal progress).
  async loadDailyWords(days?: number): Promise<DailyWordEntry[]> {
    return dwLoadEntries(days);
  },
  async loadDailyStats(): Promise<DailyStatsSummary> {
    return dwLoadStats();
  },
};

/** Register ScriptZ SQL storage after the host platform adapter is ready. */
export function registerSqlStorageAdapter(): void {
  setStorageAdapter(sqlBackedAdapter);
}

// Proxy facade: module code calls `api.getScript(id)` and always reaches the
// currently registered adapter via `getStorageAdapter()`. Functions are bound
// to the adapter so `this` references in a custom implementation keep working.
export const api: ScriptzStorage = new Proxy({} as ScriptzStorage, {
  get(_target, prop: string | symbol) {
    const a = getStorageAdapter() as unknown as Record<string | symbol, unknown>;
    const value = a[prop];
    return typeof value === "function" ? value.bind(a) : value;
  },
});
