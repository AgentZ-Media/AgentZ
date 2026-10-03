import {
  clearCharacterColor as ccClear,
  listCharacterColors as ccList,
  setCharacterColor as ccSet,
} from "./characterColors";
import {
  findUnusedCharacterNames as cuFindUnused,
  pruneUnusedCharacterNames as cuPruneUnused,
} from "./characterUsage";
import { extractTeleprompterText } from "./lex";
import { getPlatformAdapter } from "./platform";
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
  type StorageAdapter,
} from "./storage";
import {
  getAppState as dbGetAppState,
  getSetting as dbGetSetting,
  setAppState as dbSetAppState,
  setSetting as dbSetSetting,
} from "./db";
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
  deleteIdea as ideasDelete,
  listIdeas as ideasList,
  moveIdea as ideasMove,
  updateIdea as ideasUpdate,
} from "./ideas";
import {
  loadDailyWords as dwLoadEntries,
  loadStats as dwLoadStats,
} from "./dailyWords";
import { globalSearch as searchGlobal } from "./search";
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

// SQL-based default implementation of the StorageAdapter. Goes via
// the lib/* modules which speak to Tauri's plugin-sql or a sql.js
// instance in the web build via DbConnection (see ./platform.ts).
//
// On module load it is registered as the active adapter via
// `setStorageAdapter()`. The `api` export below is a proxy onto
// `getStorageAdapter()`, so a later `setStorageAdapter(dexieImpl)`
// on the web side takes effect immediately without having to switch
// the 19 call sites of `api` one by one.
const sqlBackedAdapter: StorageAdapter = {
  // Scripts - fully TS-side since Migration Phase 7d.
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
  async backfillRuntimeStats(): Promise<void> {
    return scriptsBackfillRuntime();
  },

  // Folders - TS-side via plugin-sql since Migration Phase 4.
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

  // Snapshots - TS-side via plugin-sql since Migration Phase 5.
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

  // Search - TS-side via plugin-sql since Migration Phase 6.
  async globalSearch(query: string, limit = 50): Promise<SearchHit[]> {
    return searchGlobal(query, limit);
  },

  // Settings - TS-side via plugin-sql since Migration Phase 2.
  async getSetting(key: string): Promise<string | null> {
    return dbGetSetting(key);
  },
  async setSetting(key: string, value: string): Promise<void> {
    return dbSetSetting(key, value);
  },

  // App-State - TS-side via plugin-sql since Migration Phase 2.
  async getAppState(key: string): Promise<string | null> {
    return dbGetAppState(key);
  },
  async setAppState(key: string, value: string): Promise<void> {
    return dbSetAppState(key, value);
  },

  // Character-colour records (app-wide) - TS-side via plugin-sql since
  // Migration Phase 3.
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

  // Export - fully in core since phase 2F: PDF bytes built via
  // pdf-lib (browser-compatible, see ./exportPdf.ts), plaintext via
  // extractTeleprompterText. The PlatformAdapter writes the bytes
  // out - desktop via save dialog + plugin-fs, web via blob download.
  async exportPdf(input: {
    scriptId: string;
    includeHighlighting: boolean;
    includeTitlePage: boolean;
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

  // .scriptz container (phase 2G). Pure function for serialization
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
        filters: [{ name: "ScriptZ-Datei", extensions: [SCRIPTZ_EXTENSION] }],
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
    // Carry the production stage over (new scripts start at "writing").
    if (parsed.script.status !== "writing") {
      await scriptsSetStatus(created.id, parsed.script.status);
    }
    return { scriptId: created.id, title: created.title };
  },

  // Ideas inbox - standalone table, no contact with the script CRUD.
  async listIdeas(): Promise<Idea[]> {
    return ideasList();
  },
  async createIdea(input: { title: string; notes?: string; folderId?: string | null }): Promise<Idea> {
    return ideasCreate(input);
  },
  async updateIdea(input: { id: string; title?: string; notes?: string }): Promise<Idea> {
    return ideasUpdate(input);
  },
  async deleteIdea(id: string): Promise<void> {
    return ideasDelete(id);
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

// Default registration on module load. Web builds can call
// `setStorageAdapter(webImpl)` after this point to replace the SQL impl -
// `api` (see below) always reads via `getStorageAdapter()`,
// so the swap takes effect immediately.
setStorageAdapter(sqlBackedAdapter);

// Proxy facade for drop-in compatibility. Older code that does
// `import { api } from "@scriptz/core/lib/api"` and calls `api.getScript(id)`
// passes through here to `getStorageAdapter()` - i.e. always to
// the currently registered adapter. Functions are bound to the adapter
// so any `this` references in a custom impl
// keep working.
export const api: StorageAdapter = new Proxy({} as StorageAdapter, {
  get(_target, prop: string | symbol) {
    const a = getStorageAdapter() as unknown as Record<string | symbol, unknown>;
    const value = a[prop];
    return typeof value === "function" ? value.bind(a) : value;
  },
});
