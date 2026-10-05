-- v10: Agent-Modus - Sitzungen ohne Skript und Herkunft von Ideen.
--
-- Rein additiv, bestehende Zeilen behalten ihre Bedeutung. Die Erfassung
-- der neuen Spalten im lokalen Änderungsfeed (009) ergänzt 011.
--
-- 1. agent_chats.kind: 'script' (Chat im Skript-Panel, Standard für alle
--    bestehenden Zeilen) oder 'session' (im Agent-Modus begonnen). Eine
--    Sitzung kann später an ein Skript übergeben werden (script_id gesetzt),
--    bleibt aber eine Sitzung und damit in der Sitzungsliste.
--    title: Anzeigename der Sitzung (aus der ersten Nachricht).
--    folder_id: Ordner, in dem die Sitzung arbeitet (Längenziel, Figuren).
--    Entwürfe stehen als Text in items_json und brauchen keine Tabelle.
-- 2. ideas.source_chat_id: die Sitzung, aus der eine Idee stammt (von Ida
--    gespeichert). Löschen der Sitzung lässt die Idee stehen.
-- 3. Trigger: wird ein Skript endgültig gelöscht, löst er vorher (im selben
--    DELETE, also atomar) jede Sitzung von ihm. Sonst würde die Kaskade aus
--    008 (agent_chats.script_id ON DELETE CASCADE) die ganze Sitzung samt
--    ihrer anderen Entwürfe löschen. Skript-Chats (kind 'script') gehen wie
--    bisher mit ihrem Skript.

ALTER TABLE agent_chats ADD COLUMN kind TEXT NOT NULL DEFAULT 'script';
ALTER TABLE agent_chats ADD COLUMN title TEXT;
ALTER TABLE agent_chats ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_chats_kind ON agent_chats(kind, updated_at);

ALTER TABLE ideas ADD COLUMN source_chat_id TEXT REFERENCES agent_chats(id) ON DELETE SET NULL;

CREATE TRIGGER IF NOT EXISTS agent_sessions_outlive_script
BEFORE DELETE ON scripts
BEGIN
  UPDATE agent_chats SET script_id = NULL WHERE script_id = OLD.id AND kind = 'session';
END;
