CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Cloud sync bookkeeping of the Kit account (see packages/kit/account/book.ts).
CREATE TABLE IF NOT EXISTS sync_records (
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  hash TEXT NOT NULL,
  extra TEXT,
  PRIMARY KEY (entity, entity_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sync_records_remote ON sync_records (remote_id);
CREATE TABLE IF NOT EXISTS sync_parked (
  remote_id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  hash TEXT NOT NULL,
  record TEXT NOT NULL
) WITHOUT ROWID;
