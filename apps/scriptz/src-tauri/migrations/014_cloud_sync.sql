-- Cloud sync bookkeeping (Kit account engine). Purely additive: no existing
-- table, row or trigger changes. Neither table is user content, so neither is
-- tracked by local_changes.

-- Per local record: the opaque cloud ID, the cloud revision and the content
-- hash it had when it was last synced. Cleared when another account or a new
-- encryption key takes over this device's data.
CREATE TABLE sync_records (
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (entity, entity_id)
) WITHOUT ROWID;
CREATE INDEX idx_sync_records_remote ON sync_records (remote_id);

-- Words written on other devices, per device and local day. The own device
-- keeps counting in daily_word_log; statistics add both.
CREATE TABLE daily_word_log_remote (
  device_id TEXT NOT NULL,
  date TEXT NOT NULL,
  words_added INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, date)
) WITHOUT ROWID;
CREATE INDEX idx_daily_word_log_remote_date ON daily_word_log_remote (date);
