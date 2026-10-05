-- v8: Agent - Gedächtnis, Chat-Verläufe und Lernstand.
--
-- Rein additiv, keine bestehende Tabelle wird angefasst.
--
-- 1. agent_memory: ein Eintrag pro gemerkter Sache.
--    kind = 'global'    -> Grundwissen, gilt überall (folder_id NULL)
--           'folder'    -> Ton, Welt und Muster eines Ordners
--           'character' -> Charakterprofil; folder_id NULL = Grundprofil
--                          für alle Ordner, sonst die Fassung des Ordners
--           'relation'  -> Beziehung zweier Charaktere (subject "A|B")
--    subject: Charaktername in Großbuchstaben bzw. "A|B" (alphabetisch).
--    source: 'chat' | 'script' | 'user'; source_script_id nur bei 'script'.
--    Löschen eines Ordners löscht seine Einträge mit.
-- 2. agent_chats: Chat-Verlauf je Skript (items_json = gerenderte
--    Chat-Elemente), thread_id = Thread des Anbieters (Codex) zum
--    Fortsetzen. Löschen eines Skripts löscht seine Chats.
-- 3. agent_learned: welcher Inhaltsstand eines fertigen Skripts schon
--    gelernt wurde (content_hash), damit nichts doppelt gelernt wird.

CREATE TABLE IF NOT EXISTS agent_memory (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  subject TEXT,
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat',
  source_script_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_scope ON agent_memory(kind, folder_id, subject);

CREATE TABLE IF NOT EXISTS agent_chats (
  id TEXT PRIMARY KEY,
  script_id TEXT REFERENCES scripts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  thread_id TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_chats_script ON agent_chats(script_id, updated_at);

CREATE TABLE IF NOT EXISTS agent_learned (
  script_id TEXT PRIMARY KEY REFERENCES scripts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  learned_at INTEGER NOT NULL
);
