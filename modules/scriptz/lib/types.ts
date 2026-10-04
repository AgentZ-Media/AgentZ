// Mirror of src-tauri/src/models.rs

export interface ScriptCharacter {
  name: string;
  color: string;
  /** Share of this character's dialog words in the script, 0..1.
   *  Filled in during save in `scripts.ts` via `dialogWordsByCharacter`
   *  (in `lib/lex.ts`). Optional, because older database
   *  entries didn't have the field before the upgrade - it's
   *  backfilled on the next save. */
  share?: number;
}

export interface CharacterColorRecord {
  name: string;
  default_color: string | null;
  override_color: string | null;
  updated_at: number;
}

/** Production stage of a script (Werkbank redesign). Lives on every
 *  script; new scripts start at "writing". */
export type ScriptStatus = "writing" | "ready" | "shot" | "online";

/** Pipeline stage as shown in the sidebar / overview: ideas are a stage
 *  before any script exists. */
export type Stage = "idea" | ScriptStatus;

/** All script statuses in pipeline order. */
export const SCRIPT_STATUSES: readonly ScriptStatus[] = [
  "writing",
  "ready",
  "shot",
  "online",
] as const;

/** Last pipeline stage. Scripts here are done; every earlier stage counts as
 *  work in progress (the sidebar inbox). Derived, so new stages stay covered. */
export const FINAL_SCRIPT_STATUS: ScriptStatus = SCRIPT_STATUSES[SCRIPT_STATUSES.length - 1];

/** True while a script still sits before the last pipeline stage. */
export function isInProgress(status: ScriptStatus): boolean {
  return status !== FINAL_SCRIPT_STATUS;
}

/** Type guard for values read from storage / files. */
export function isScriptStatus(v: unknown): v is ScriptStatus {
  return v === "writing" || v === "ready" || v === "shot" || v === "online";
}

export interface ScriptSummary {
  id: string;
  title: string;
  highlighting_enabled: number | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  page_count: number;
  /** Last calculated word count. -1 = sentinel "never counted"
   *  (newly created or migrated before the word-count backfill).
   *  Consumers should treat negative values as 0. */
  word_count: number;
  /** Dialog words at the last save - input for the runtime formula
   *  in `lib/runtime.ts`. -1 = sentinel "never measured". */
  dialog_word_count: number;
  /** Number of action blocks at the last save - each block
   *  contributes a 2s beat to the runtime. -1 = sentinel. */
  direction_block_count: number;
  characters: ScriptCharacter[];
  folder_id: string | null;
  /** Production stage. Defaults to "writing" for new and pre-redesign rows. */
  status: ScriptStatus;
  /** Unix-millis of the last status change; null = never changed. */
  status_changed_at: number | null;
}

export interface Script extends ScriptSummary {
  content_json: string;
}

export interface Folder {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  script_count: number;
  /** Target runtime range in whole seconds (see docs/feature-laengenziel.md).
   *  null = bound not set. When both are set, min < max. */
  length_min_sec: number | null;
  length_max_sec: number | null;
}

export interface Snapshot {
  id: string;
  script_id: string;
  content_json: string;
  trigger: "auto" | "manual";
  created_at: number;
}

export interface SnapshotMeta {
  id: string;
  script_id: string;
  trigger: "auto" | "manual";
  created_at: number;
}

export interface SearchHit {
  kind: "script";
  id: string;
  title: string;
  snippet: string;
  meta: Record<string, unknown>;
}

/** The four block types of the editor. Older content may still contain
 *  the retired types (camera, caption, sfx) - those are converted to action
 *  by `lib/legacyBlocks.ts` wherever content is parsed. */
export type BlockType =
  | "scriptz-action"
  | "scriptz-character"
  | "scriptz-dialog"
  | "scriptz-parenthetical";

/** A writing idea from the ideas drawer. `usedAt` marks the
 *  conversion into a real script. `folder_id` shares the same
 *  folders as scripts (NULL = no folder), so a client/project
 *  folder can hold both its ideas and its scripts. */
export interface Idea {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  used_at: number | null;
  script_id: string | null;
  folder_id: string | null;
}

/** An entry in the daily word log. `date` is in local
 *  YYYY-MM-DD format (no timezone drift). */
export interface DailyWordEntry {
  date: string;
  words_added: number;
}

/** Aggregated writing statistics for the home strip + activity modal. */
export interface DailyStatsSummary {
  /** Words added today (local midnight until now). */
  wordsToday: number;
  /** Words since Monday of the current ISO week (Mon 00:00 until now). */
  wordsThisWeek: number;
  /** Number of consecutive writing days, ending today or yesterday. */
  streakDays: number;
  /** 365-day history, oldest first, today last. */
  dailyWords: number[];
  /** Number of days in the last 365 with > 0 words written. */
  activeDays: number;
  /** Sum of words in the 365-day window. */
  totalWords: number;
}
