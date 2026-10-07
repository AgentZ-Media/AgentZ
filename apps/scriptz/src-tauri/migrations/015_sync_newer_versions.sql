-- Cloud sync: keep data written by newer app versions (Kit account engine,
-- docs/cloud-sync.md). Purely additive, no user content, not tracked by
-- local_changes.

-- Fields of a synced record this version does not know, as a JSON object.
-- They go back up with the next upload of the record and reach the local
-- table once an update knows them.
ALTER TABLE sync_records ADD COLUMN extra TEXT;

-- Cloud records of an entity or setting this version does not know. They are
-- applied by the first sync after an update that knows them. `upload` = 1:
-- the cloud copy was replaced (new key, other account), this device uploads
-- the record again.
CREATE TABLE sync_parked (
  remote_id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  hash TEXT NOT NULL,
  record TEXT NOT NULL,
  upload INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
