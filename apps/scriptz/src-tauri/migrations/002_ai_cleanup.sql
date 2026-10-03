-- Drop the AI feature leftovers (summary columns + ai.* settings).
-- ALTER TABLE DROP COLUMN works since SQLite 3.35; tauri-plugin-sql v2
-- bundles a newer libsqlite3-sys (3.45+), so this is safe.
--
-- The columns are guaranteed to exist after migration 001 has run, on
-- both fresh and existing DBs — the baseline includes them on purpose
-- so this drop has a uniform shape.

ALTER TABLE scripts DROP COLUMN summary;
ALTER TABLE scripts DROP COLUMN summary_source_text;
ALTER TABLE scripts DROP COLUMN summary_generated_at;
ALTER TABLE scripts DROP COLUMN summary_model;
ALTER TABLE scripts DROP COLUMN summary_source_tokens;

DELETE FROM settings WHERE key LIKE 'ai.%';
