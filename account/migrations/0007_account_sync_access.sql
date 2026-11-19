ALTER TABLE accounts ADD COLUMN sync_key_verifier TEXT;

CREATE TABLE account_unlocks (
  token_hash TEXT PRIMARY KEY NOT NULL,
  credential_id TEXT NOT NULL REFERENCES passkeys(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_unlocks_expiry ON account_unlocks(expires_at);
