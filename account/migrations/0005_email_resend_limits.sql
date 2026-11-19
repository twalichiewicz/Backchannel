ALTER TABLE account_email_sends ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_email_sends ADD COLUMN window_expires_at INTEGER NOT NULL DEFAULT 0;
