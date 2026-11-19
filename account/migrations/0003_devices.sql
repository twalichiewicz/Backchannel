ALTER TABLE sessions ADD COLUMN device_id TEXT;
ALTER TABLE sessions ADD COLUMN device_name TEXT;
ALTER TABLE sessions ADD COLUMN device_seen_at INTEGER;

CREATE INDEX sessions_account_device ON sessions(account_id, device_id, expires_at)
  WHERE device_id IS NOT NULL;
