-- Local-only synchronization preparation. No network, accounts or settings.
-- Each content statement and its marker commit/roll back together in SQLite.
-- One latest marker per record bounds repeated autosaves; deleted records retain
-- only a tombstone. No content copies and no per-keystroke history are stored.
-- A sequence is local to replica_id, NOT a server revision or timestamp.

CREATE TABLE local_replica (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  replica_id TEXT NOT NULL
);
INSERT INTO local_replica (singleton, replica_id) VALUES (
  1, lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', (random() & 3) + 1, 1) || substr(lower(hex(randomblob(2))), 2) ||
  '-' || lower(hex(randomblob(6)))
);

CREATE TABLE local_changes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('scripts', 'folders', 'ideas', 'snapshots', 'character_colors', 'agent_chats', 'agent_memory', 'agent_learned', 'daily_word_log')),
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  UNIQUE (entity, entity_id)
);

-- scripts: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'scripts', id, 'upsert' FROM scripts;

CREATE TRIGGER track_scripts_insert AFTER INSERT ON scripts
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('scripts', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_scripts_update AFTER UPDATE ON scripts
WHEN OLD.id IS NOT NEW.id
  OR OLD.title IS NOT NEW.title
  OR OLD.highlighting_enabled IS NOT NEW.highlighting_enabled
  OR OLD.content_json IS NOT NEW.content_json
  OR OLD.characters_meta IS NOT NEW.characters_meta
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.archived_at IS NOT NEW.archived_at
  OR OLD.page_count IS NOT NEW.page_count
  OR OLD.folder_id IS NOT NEW.folder_id
  OR OLD.last_word_count IS NOT NEW.last_word_count
  OR OLD.dialog_word_count IS NOT NEW.dialog_word_count
  OR OLD.direction_block_count IS NOT NEW.direction_block_count
  OR OLD.status IS NOT NEW.status
  OR OLD.status_changed_at IS NOT NEW.status_changed_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('scripts', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_scripts_key AFTER UPDATE OF id ON scripts
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('scripts', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_scripts_delete AFTER DELETE ON scripts
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('scripts', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- folders: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'folders', id, 'upsert' FROM folders;

CREATE TRIGGER track_folders_insert AFTER INSERT ON folders
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('folders', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_folders_update AFTER UPDATE ON folders
WHEN OLD.id IS NOT NEW.id
  OR OLD.name IS NOT NEW.name
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
  OR OLD.length_min_sec IS NOT NEW.length_min_sec
  OR OLD.length_max_sec IS NOT NEW.length_max_sec
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('folders', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_folders_key AFTER UPDATE OF id ON folders
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('folders', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_folders_delete AFTER DELETE ON folders
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('folders', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- ideas: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'ideas', id, 'upsert' FROM ideas;

CREATE TRIGGER track_ideas_insert AFTER INSERT ON ideas
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('ideas', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_ideas_update AFTER UPDATE ON ideas
WHEN OLD.id IS NOT NEW.id
  OR OLD.title IS NOT NEW.title
  OR OLD.notes IS NOT NEW.notes
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.used_at IS NOT NEW.used_at
  OR OLD.script_id IS NOT NEW.script_id
  OR OLD.folder_id IS NOT NEW.folder_id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('ideas', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_ideas_key AFTER UPDATE OF id ON ideas
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('ideas', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_ideas_delete AFTER DELETE ON ideas
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('ideas', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- snapshots: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'snapshots', id, 'upsert' FROM snapshots;

CREATE TRIGGER track_snapshots_insert AFTER INSERT ON snapshots
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('snapshots', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_snapshots_update AFTER UPDATE ON snapshots
WHEN OLD.id IS NOT NEW.id
  OR OLD.script_id IS NOT NEW.script_id
  OR OLD.content_json IS NOT NEW.content_json
  OR OLD.trigger IS NOT NEW.trigger
  OR OLD.created_at IS NOT NEW.created_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('snapshots', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_snapshots_key AFTER UPDATE OF id ON snapshots
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('snapshots', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_snapshots_delete AFTER DELETE ON snapshots
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('snapshots', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- character_colors: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'character_colors', upper(name), 'upsert' FROM character_colors;

CREATE TRIGGER track_character_colors_insert AFTER INSERT ON character_colors
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('character_colors', upper(NEW.name), 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_character_colors_update AFTER UPDATE ON character_colors
WHEN OLD.name COLLATE BINARY IS NOT NEW.name COLLATE BINARY
  OR OLD.default_color IS NOT NEW.default_color
  OR OLD.override_color IS NOT NEW.override_color
  OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('character_colors', upper(NEW.name), 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_character_colors_key AFTER UPDATE OF name ON character_colors
WHEN upper(OLD.name) IS NOT upper(NEW.name)
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('character_colors', upper(OLD.name), 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_character_colors_delete AFTER DELETE ON character_colors
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('character_colors', upper(OLD.name), 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- agent_chats: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'agent_chats', id, 'upsert' FROM agent_chats;

CREATE TRIGGER track_agent_chats_insert AFTER INSERT ON agent_chats
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_chats', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_chats_update AFTER UPDATE ON agent_chats
WHEN OLD.id IS NOT NEW.id
  OR OLD.script_id IS NOT NEW.script_id
  OR OLD.provider IS NOT NEW.provider
  OR OLD.thread_id IS NOT NEW.thread_id
  OR OLD.items_json IS NOT NEW.items_json
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_chats', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_chats_key AFTER UPDATE OF id ON agent_chats
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_chats', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_chats_delete AFTER DELETE ON agent_chats
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_chats', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- agent_memory: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'agent_memory', id, 'upsert' FROM agent_memory;

CREATE TRIGGER track_agent_memory_insert AFTER INSERT ON agent_memory
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_memory', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_memory_update AFTER UPDATE ON agent_memory
WHEN OLD.id IS NOT NEW.id
  OR OLD.kind IS NOT NEW.kind
  OR OLD.folder_id IS NOT NEW.folder_id
  OR OLD.subject IS NOT NEW.subject
  OR OLD.content IS NOT NEW.content
  OR OLD.source IS NOT NEW.source
  OR OLD.source_script_id IS NOT NEW.source_script_id
  OR OLD.created_at IS NOT NEW.created_at
  OR OLD.updated_at IS NOT NEW.updated_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_memory', NEW.id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_memory_key AFTER UPDATE OF id ON agent_memory
WHEN OLD.id IS NOT NEW.id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_memory', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_memory_delete AFTER DELETE ON agent_memory
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_memory', OLD.id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- agent_learned: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'agent_learned', script_id, 'upsert' FROM agent_learned;

CREATE TRIGGER track_agent_learned_insert AFTER INSERT ON agent_learned
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_learned', NEW.script_id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_learned_update AFTER UPDATE ON agent_learned
WHEN OLD.script_id IS NOT NEW.script_id
  OR OLD.content_hash IS NOT NEW.content_hash
  OR OLD.learned_at IS NOT NEW.learned_at
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_learned', NEW.script_id, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_learned_key AFTER UPDATE OF script_id ON agent_learned
WHEN OLD.script_id IS NOT NEW.script_id
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_learned', OLD.script_id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_agent_learned_delete AFTER DELETE ON agent_learned
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('agent_learned', OLD.script_id, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

-- daily_word_log: seed existing content without modifying any user row.
INSERT INTO local_changes (entity, entity_id, operation)
SELECT 'daily_word_log', date, 'upsert' FROM daily_word_log;

CREATE TRIGGER track_daily_word_log_insert AFTER INSERT ON daily_word_log
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('daily_word_log', NEW.date, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_daily_word_log_update AFTER UPDATE ON daily_word_log
WHEN OLD.date IS NOT NEW.date
  OR OLD.words_added IS NOT NEW.words_added
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('daily_word_log', NEW.date, 'upsert')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_daily_word_log_key AFTER UPDATE OF date ON daily_word_log
WHEN OLD.date IS NOT NEW.date
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('daily_word_log', OLD.date, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;

CREATE TRIGGER track_daily_word_log_delete AFTER DELETE ON daily_word_log
BEGIN
  INSERT INTO local_changes (entity, entity_id, operation)
  VALUES ('daily_word_log', OLD.date, 'delete')
  ON CONFLICT(entity, entity_id) DO UPDATE SET
    sequence = excluded.sequence, operation = excluded.operation;
END;
