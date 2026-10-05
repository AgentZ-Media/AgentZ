-- v11: Lokaler Änderungsfeed (009) erfasst die Spalten aus 010.
--
-- Die Update-Trigger aus 009 nennen ihre Spalten einzeln. Ohne diese
-- Migration bliebe eine Änderung nur an agent_chats.kind/title/folder_id oder
-- ideas.source_chat_id ohne Marker, etwa das Umbenennen einer Sitzung oder das
-- Lösen der Herkunft, wenn eine Sitzung gelöscht wird (ON DELETE SET NULL).
--
-- Bestehende Zeilen sind bereits durch 009 erfasst, hier wird nichts nachgesät
-- und keine Nutzerzeile verändert. Die Reihenfolge 009 vor 010 oder 010 vor
-- 009 (Entwicklungsdatenbanken) führt zum selben Ergebnis.

DROP TRIGGER IF EXISTS track_agent_chats_update;
CREATE TRIGGER track_agent_chats_update AFTER UPDATE ON agent_chats
WHEN OLD.id IS NOT NEW.id
  OR OLD.script_id IS NOT NEW.script_id
  OR OLD.provider IS NOT NEW.provider
  OR OLD.thread_id IS NOT NEW.thread_id
  OR OLD.items_json IS NOT NEW.items_json
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.kind IS NOT NEW.kind
  OR OLD.title IS NOT NEW.title
  OR OLD.folder_id IS NOT NEW.folder_id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_chats', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

DROP TRIGGER IF EXISTS track_ideas_update;
CREATE TRIGGER track_ideas_update AFTER UPDATE ON ideas
WHEN OLD.id IS NOT NEW.id
  OR OLD.title IS NOT NEW.title
  OR OLD.notes IS NOT NEW.notes
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.used_at IS NOT NEW.used_at
  OR OLD.script_id IS NOT NEW.script_id
  OR OLD.folder_id IS NOT NEW.folder_id
  OR OLD.source_chat_id IS NOT NEW.source_chat_id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('ideas', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;
