-- Baseline schema for fresh installs.
--
-- For existing users (DBs that went through the old Rust migrations v2-v7),
-- every CREATE here is a no-op thanks to IF NOT EXISTS, and the data stays
-- untouched.
--
-- The AI summary columns are intentionally included even though the AI
-- features were removed in 2026-05. Including them in the baseline lets
-- migration 002 use ALTER TABLE DROP COLUMN uniformly on both fresh and
-- existing DBs, instead of needing a conditional path. They get dropped
-- immediately by 002 and never carry data on a fresh install.

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Unbenannt',
  highlighting_enabled INTEGER, -- NULL = global default, 0/1 = per-script override
  content_json TEXT NOT NULL,
  characters_meta TEXT NOT NULL DEFAULT '[]', -- JSON array of {name, color}
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  page_count INTEGER NOT NULL DEFAULT 1,
  -- AI leftover columns; dropped by migration 002.
  summary TEXT,
  summary_source_text TEXT,
  summary_generated_at INTEGER,
  summary_model TEXT,
  summary_source_tokens TEXT,
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  trigger TEXT NOT NULL, -- 'auto' | 'manual'
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS character_colors (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  default_color TEXT,
  override_color TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS scripts_fts USING fts5(
  script_id UNINDEXED,
  title,
  content_text,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE INDEX IF NOT EXISTS idx_scripts_updated_at ON scripts(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_scripts_archived ON scripts(archived_at);
CREATE INDEX IF NOT EXISTS idx_scripts_folder ON scripts(folder_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_script ON snapshots(script_id, created_at DESC);
