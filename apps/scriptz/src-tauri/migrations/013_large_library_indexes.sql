-- v13: Indizes für große Bibliotheken (10.000 Skripte und mehr).
--
-- Rein additiv: keine Spalte und keine Inhaltszeile ändert sich. Neu ist nur
-- die Zuordnung des Suchindex, und der ist aus den Skripten ableitbar.
--
-- 1. idx_scripts_summary deckt jede Spalte der Skriptliste ab. Diese Spalten
--    liegen in der Zeile hinter content_json; ohne den Index liest SQLite für
--    die Liste den Inhalt jedes Skripts mit (Überlaufseiten).
-- 2. idx_scripts_folder_live zählt die Skripte pro Ordner, ohne Skriptzeilen
--    zu lesen.
-- 3. Fremdschlüssel auf Löschpfaden (Skript, Chat, Ordner): ohne Index prüft
--    SQLite beim Löschen jede Zeile der verweisenden Tabelle.
-- 4. scripts_fts_map gibt jedem Skript eine feste Zeile im Suchindex. Die
--    Spalte script_id ist dort UNINDEXED, Löschen über sie durchsucht den
--    ganzen Index; über die rowid ist es ein direkter Zugriff. Doppelte
--    Indexzeilen eines Skripts werden dabei bereinigt (die zuletzt
--    geschriebene bleibt, das nächste Speichern schreibt sie ohnehin neu).

CREATE INDEX IF NOT EXISTS idx_scripts_summary ON scripts(
  archived_at, updated_at DESC, id, title, highlighting_enabled, characters_meta,
  created_at, page_count, last_word_count, dialog_word_count, direction_block_count,
  folder_id, status, status_changed_at
);
CREATE INDEX IF NOT EXISTS idx_scripts_folder_live ON scripts(folder_id, archived_at);

CREATE INDEX IF NOT EXISTS idx_ideas_script ON ideas(script_id);
CREATE INDEX IF NOT EXISTS idx_ideas_source_chat ON ideas(source_chat_id);
CREATE INDEX IF NOT EXISTS idx_agent_chats_folder ON agent_chats(folder_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_folder ON agent_memory(folder_id);

CREATE TABLE IF NOT EXISTS scripts_fts_map (
  fts_rowid INTEGER PRIMARY KEY,
  script_id TEXT NOT NULL UNIQUE
);

DELETE FROM scripts_fts
 WHERE rowid NOT IN (SELECT MAX(rowid) FROM scripts_fts GROUP BY script_id);

INSERT OR IGNORE INTO scripts_fts_map (fts_rowid, script_id)
  SELECT rowid, script_id FROM scripts_fts;
