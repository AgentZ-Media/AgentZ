// High-level storage adapter for @agentz/scriptz.
//
// DbConnection abstracts raw SQL access; ScriptzStorage provides typed
// CRUD methods. The SQL-backed default in ./api.ts uses DbConnection,
// while alternative hosts can supply a different persistence backend.
//
// The `api` export is a proxy onto `getStorageAdapter()`, so replacing
// the adapter takes effect immediately for existing callers.

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
import { t } from "../i18n";
import type { AgentStorage } from "./agent/storage";
import type { LocalChangeStore } from "./localChanges/types";

export interface CreateScriptInput {
  title?: string;
  initialContentJson?: string;
  folderId?: string | null;
}

export interface UpdateScriptInput {
  id: string;
  title?: string;
  highlightingEnabled?: number | null;
  contentJson?: string;
  characters?: ScriptCharacter[];
  /** Internal content rewrite (e.g. the legacy-block boot migration in
   *  `lib/legacyBlocksMigration.ts`): the new content is stored and all
   *  derived stats (word count sentinel, runtime stats, characters, FTS)
   *  are refreshed, but NO words are booked into the daily word log and
   *  `updated_at` stays untouched, so a migration neither inflates the
   *  writing counter nor reorders "recently edited" lists. Not for UI use. */
  internalRewrite?: boolean;
}

export interface ListScriptsQuery {
  includeArchived?: boolean;
  onlyArchived?: boolean;
  sort?: "updated" | "created" | "title";
  query?: string;
  limit?: number;
  offset?: number;
  folderId?: string | null;
  /** Only scripts in this production stage. undefined = all stages. */
  status?: ScriptStatus;
}

export interface CreateIdeaInput {
  title: string;
  notes?: string;
  /** Optional target folder (shared with scripts). NULL/undefined =
   *  no folder. */
  folderId?: string | null;
  /** Agent session the idea was saved from (agent mode). */
  sourceChatId?: string | null;
}

export interface UpdateIdeaInput {
  id: string;
  title?: string;
  notes?: string;
}

export interface ConvertIdeaInput {
  ideaId: string;
  folderId?: string | null;
  /** If true, the idea's notes are seeded as the first action block of the
   *  new script. Default FALSE: the notes stay on the idea and the
   *  inspector shows them under "Aus der Idee". */
  notesAsAction?: boolean;
}

export interface ExportPdfRequest {
  scriptId: string;
  includeHighlighting: boolean;
  includeTitlePage: boolean;
  /** Detail line of the title page (folder, runtime, date). */
  titleDetails?: string | null;
}

export interface ExportPlaintextRequest {
  scriptId: string;
}

export interface ExportResult {
  /** True when the user cancelled (desktop: save dialog cancel).
   *  Callers should then not show an "export saved" toast. */
  cancelled: boolean;
  /** Absolute path on desktop, null in the browser. */
  path: string | null;
}

export interface ScriptzStorage {
  /** User-authored agent content uses the same storage boundary as scripts. */
  agent: AgentStorage;
  /** Local change feed only; no cloud provider or network is installed. */
  localChanges: LocalChangeStore;
  // ===== Scripts =====
  createScript(input: CreateScriptInput): Promise<ScriptSummary>;
  getScript(id: string): Promise<Script>;
  updateScript(input: UpdateScriptInput): Promise<ScriptSummary>;
  listScripts(query?: ListScriptsQuery): Promise<ScriptSummary[]>;
  archiveScript(id: string): Promise<void>;
  restoreScript(id: string): Promise<void>;
  purgeScript(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  /** Deletes scripts that went to the trash at or before `cutoff` (ms);
   *  returns how many were removed. */
  purgeExpiredTrash(cutoff: number): Promise<number>;
  duplicateScript(id: string): Promise<ScriptSummary>;
  renameScript(id: string, title: string): Promise<ScriptSummary>;
  /** Moves a script to another production stage. Sets
   *  `status_changed_at = Date.now()` when the status actually changes;
   *  does not touch `updated_at` (a stage change is not an edit). */
  setScriptStatus(id: string, status: ScriptStatus): Promise<ScriptSummary>;
  /** Number of scripts (trash included) stored with this stage id. */
  countScriptsWithStatus(status: ScriptStatus): Promise<number>;
  /** Moves every script (trash included) from stage `from` to `to` before
   *  `from` leaves the pipeline. Keeps `status_changed_at` and
   *  `updated_at`; returns the number of moved scripts. */
  reassignScriptStatus(from: ScriptStatus, to: ScriptStatus): Promise<number>;
  /** Recomputes the stored runtime inputs: only never-measured scripts,
   *  or every script with `all`. */
  backfillRuntimeStats(opts?: { all?: boolean }): Promise<void>;

  // ===== Folders =====
  listFolders(): Promise<Folder[]>;
  countLiveScripts(): Promise<number>;
  createFolder(name: string): Promise<Folder>;
  renameFolder(id: string, name: string): Promise<Folder>;
  /** Sets the folder's target runtime range in whole seconds. null clears a
   *  bound. Throws when a bound is negative / not an integer or when both
   *  are set and min >= max (see `validateLengthRange`). */
  setFolderLengthRange(
    id: string,
    minSec: number | null,
    maxSec: number | null,
  ): Promise<Folder>;
  deleteFolder(id: string): Promise<void>;
  moveScript(scriptId: string, folderId: string | null): Promise<void>;
  moveScripts(scriptIds: string[], folderId: string | null): Promise<void>;

  // ===== Snapshots =====
  createSnapshot(scriptId: string, trigger: "auto" | "manual"): Promise<SnapshotMeta>;
  listSnapshots(scriptId: string): Promise<SnapshotMeta[]>;
  getSnapshot(id: string): Promise<Snapshot>;
  restoreSnapshot(snapshotId: string): Promise<void>;
  deleteSnapshot(id: string): Promise<void>;

  // ===== Search =====
  globalSearch(query: string, limit?: number): Promise<SearchHit[]>;

  // ===== Character-Colors =====
  listCharacterColors(): Promise<CharacterColorRecord[]>;
  setCharacterColor(name: string, color: string): Promise<string[]>;
  /** Clear the manual override and fall back to the recorded default.
   * `activeScriptId` is the palette context used when no default has
   * been recorded yet - so the freshly-picked colour avoids colliding
   * with other characters in the script the writer is currently looking
   * at. */
  clearCharacterColor(name: string, activeScriptId?: string): Promise<string[]>;
  /** Registry names that no stored script (trash included) references.
   *  Scans `characters_meta` page by page and yields to the UI between
   *  pages (see `lib/characterUsage.ts`), so it stays responsive with
   *  thousands of scripts. */
  findUnusedCharacterNames(): Promise<string[]>;
  /** Deletes registry entries no stored script references - only those
   *  in `only` when given - and returns the deleted names. Re-checks usage
   *  itself; a name that got used again in the meantime is kept. */
  pruneUnusedCharacterNames(only?: string[]): Promise<string[]>;

  // ===== Export (delegates internally to PlatformAdapter) =====
  exportPdf(input: ExportPdfRequest): Promise<ExportResult>;
  exportPlaintext(input: ExportPlaintextRequest): Promise<ExportResult>;
  /** Writes the script as a .scriptz file (blob download on web,
   *  save dialog on desktop). */
  exportScriptz(scriptId: string): Promise<ExportResult>;
  /** Reads a .scriptz file from the user (open dialog) and creates a new
   *  script from it. Returns null if the user cancels. */
  importScriptz(): Promise<{ scriptId: string; title: string } | null>;

  // ===== Ideas inbox =====
  listIdeas(): Promise<Idea[]>;
  createIdea(input: CreateIdeaInput): Promise<Idea>;
  updateIdea(input: UpdateIdeaInput): Promise<Idea>;
  deleteIdea(id: string): Promise<void>;
  /** Puts a deleted idea back (undo); missing folder/script links drop. */
  restoreIdea(idea: Idea): Promise<void>;
  /** Moves an idea into a folder (or out of any folder when null).
   *  Shares the same folders as scripts. */
  moveIdea(ideaId: string, folderId: string | null): Promise<void>;
  convertIdeaToScript(
    input: ConvertIdeaInput,
  ): Promise<{ idea: Idea; script: ScriptSummary }>;
  /** Marks an open idea as used by an existing script. False when the idea
   *  is gone or already used. */
  markIdeaUsed(ideaId: string, scriptId: string): Promise<boolean>;

  // ===== Writing statistics =====
  loadDailyWords(days?: number): Promise<DailyWordEntry[]>;
  loadDailyStats(): Promise<DailyStatsSummary>;
}

/** Shared validation for `setFolderLengthRange` (all adapters). Returns the
 *  normalized pair or throws a user-facing (translated) error. Rules:
 *  null = unset; otherwise a non-negative whole number of seconds; when
 *  both are set, min must be strictly below max. */
export function validateLengthRange(
  minSec: number | null,
  maxSec: number | null,
): { minSec: number | null; maxSec: number | null } {
  const check = (v: number | null): number | null => {
    if (v === null) return null;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error(t("folder.error.lengthInvalid"));
    }
    return v;
  };
  const min = check(minSec);
  const max = check(maxSec);
  if (min !== null && max !== null && min >= max) {
    throw new Error(t("folder.error.lengthOrder"));
  }
  return { minSec: min, maxSec: max };
}

let adapter: ScriptzStorage | null = null;

/** Register the high-level storage adapter. Called once at app
 * startup. The SQL-backed default is registered explicitly; a host can
 * replace it with another persistence backend. Kit key-value storage is
 * registered separately by the host. */
export function setStorageAdapter(a: ScriptzStorage): void {
  adapter = a;
}

export function getStorageAdapter(): ScriptzStorage {
  if (!adapter) {
    throw new Error(
      "Storage adapter not set. Call registerSqlStorageAdapter() or setStorageAdapter() before this call.",
    );
  }
  return adapter;
}
