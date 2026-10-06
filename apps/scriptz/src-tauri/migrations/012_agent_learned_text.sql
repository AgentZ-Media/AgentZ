-- v12: Agent - gelernter Textstand pro Skript.
--
-- Rein additiv, bestehende Zeilen bleiben unverändert (learned_text NULL).
--
-- 1. agent_learned.learned_text: der Skripttext (eine Zeile pro Block,
--    "typ:text"), aus dem zuletzt gelernt wurde. Damit erkennt der Agent, ob
--    sich ein schon gelerntes Skript nennenswert geändert hat, und lernt nach
--    kleinen Korrekturen nicht erneut. Zeilen ohne Text (vor v12 gelernt)
--    gelten bei jeder Änderung als nennenswert geändert.
-- 2. Der Update-Trigger des lokalen Änderungsfeeds (009) nennt seine Spalten
--    einzeln und erfasst die neue Spalte mit.

ALTER TABLE agent_learned ADD COLUMN learned_text TEXT;

DROP TRIGGER IF EXISTS track_agent_learned_update;
CREATE TRIGGER track_agent_learned_update AFTER UPDATE ON agent_learned
WHEN OLD.script_id IS NOT NEW.script_id
  OR OLD.content_hash IS NOT NEW.content_hash
  OR OLD.learned_at IS NOT NEW.learned_at
  OR OLD.learned_text IS NOT NEW.learned_text
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_learned', NEW.script_id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;
