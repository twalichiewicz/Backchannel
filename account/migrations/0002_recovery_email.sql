ALTER TABLE accounts ADD COLUMN recovery_email TEXT;
ALTER TABLE accounts ADD COLUMN recovery_epoch INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX accounts_recovery_email ON accounts(recovery_email) WHERE recovery_email IS NOT NULL;

ALTER TABLE ceremonies ADD COLUMN recovery_email TEXT;
ALTER TABLE ceremonies ADD COLUMN recovery_epoch INTEGER;

CREATE TABLE account_email_codes (
  code_hash TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  recovery_epoch INTEGER,
  session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_email_codes_account ON account_email_codes(account_id);
CREATE INDEX account_email_codes_session ON account_email_codes(session_hash);
CREATE INDEX account_email_codes_expiry ON account_email_codes(expires_at);

CREATE TABLE account_email_sends (
  kind TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (kind, email_hash)
);
CREATE INDEX account_email_sends_expiry ON account_email_sends(expires_at);
