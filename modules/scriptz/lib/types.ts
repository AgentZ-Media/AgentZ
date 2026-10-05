// Mirror of src-tauri/src/models.rs

export interface ScriptCharacter {
  name: string;
  color: string;
  /** Share of this character's dialog words in the script, 0..1.
   *  Filled in during save in `scripts.ts` via `dialogWordsByCharacter`
   *  (in `lib/lex.ts`). Optional, because stored entries may lack
   *  the field - it's backfilled on the next save. */
  share?: number;
}

export interface CharacterColorRecord {
  name: string;
  default_color: string | null;
  override_color: string | null;
  updated_at: number;
}

/** Production stage of a script: the id of one of the configurable stages
 *  in lib/stages.ts (built-in: "writing", "ready", "shot", "online"). New
 *  scripts start at the first stage, the last one means "done". */
export type ScriptStatus = string;

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
  /** Production stage id. Rows whose stage no longer exists read as the
   *  first stage (see `resolveStageId`). */
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
  /** Target runtime range in whole seconds.
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
  /** Agent session the idea was saved from; absent/null = written by hand. */
  source_chat_id?: string | null;
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
