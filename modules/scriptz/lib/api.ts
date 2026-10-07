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
import { getStorageAdapter, setStorageAdapter, type ScriptzStorage } from "./storage";
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
  purgeExpiredTrash as scriptsPurgeExpiredTrash,
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

// SQL-based product storage. Shared key-value storage lives in Kit. The lib/*
// modules access the host database via DbConnection (see @agentz/kit/platform).
// Registered explicitly by the host; the `api` proxy reads the active
// adapter on every call, so hosts can replace storage without changing callers.
const sqlBackedAdapter: ScriptzStorage = {
  agent: sqlAgentStorage,
  localChanges: sqlLocalChanges,
  // Scripts. The lib functions are mapped directly where their signature
  // already matches `ScriptzStorage`; wrappers remain only where the argument
  // shape differs.
  async createScript(input) {
    return scriptsCreate(
      input.title ?? null,
      input.initialContentJson ?? null,
      input.folderId ?? null,
    );
  },
  getScript: scriptsGet,
  updateScript: scriptsUpdate,
  async listScripts(query = {}) {
    return scriptsList(query);
  },
  archiveScript: scriptsArchive,
  restoreScript: scriptsRestore,
  purgeScript: scriptsPurge,
  emptyTrash: scriptsEmptyTrash,
  purgeExpiredTrash: scriptsPurgeExpiredTrash,
  duplicateScript: scriptsDuplicate,
  renameScript: scriptsRename,
  setScriptStatus: scriptsSetStatus,
  countScriptsWithStatus: scriptsCountWithStatus,
  reassignScriptStatus: scriptsReassignStatus,
  backfillRuntimeStats: scriptsBackfillRuntime,

  // Folders
  listFolders: foldersList,
  countLiveScripts: foldersCountLive,
  createFolder: foldersCreate,
  renameFolder: foldersRename,
  setFolderLengthRange: foldersSetLengthRange,
  deleteFolder: foldersDelete,
  moveScript: foldersMoveScript,
  moveScripts: foldersMoveScripts,

  // Snapshots
  createSnapshot: snapsCreate,
  listSnapshots: snapsList,
  getSnapshot: snapsGet,
  restoreSnapshot: snapsRestore,
  deleteSnapshot: snapsDelete,

  // Search
  globalSearch: searchGlobal,

  // Character-colour records (app-wide)
  listCharacterColors: ccList,
  setCharacterColor: ccSet,
  async clearCharacterColor(name, activeScriptId) {
    return ccClear(name, activeScriptId ?? null);
  },
  findUnusedCharacterNames: cuFindUnused,
  pruneUnusedCharacterNames: cuPruneUnused,

  // Export: PDF bytes via pdf-lib (./exportPdf.ts), plaintext via
  // extractTeleprompterText; the platform adapter writes the bytes.
  async exportPdf(input) {
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
  async exportPlaintext(input) {
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
  async exportScriptz(scriptId) {
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

  async importScriptz() {
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

  // Ideas inbox.
  listIdeas: ideasList,
  createIdea: ideasCreate,
  markIdeaUsed: ideasMarkUsed,
  updateIdea: ideasUpdate,
  deleteIdea: ideasDelete,
  restoreIdea: ideasRestore,
  moveIdea: ideasMove,
  convertIdeaToScript: ideasConvert,

  // Daily writing statistics (heatmap / writing counter).
  loadDailyWords: dwLoadEntries,
  loadDailyStats: dwLoadStats,
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
