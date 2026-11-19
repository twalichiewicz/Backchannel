CREATE TABLE account_signups (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL UNIQUE,
  recovery_email TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  envelope TEXT NOT NULL CHECK(length(envelope) = 80),
  sync_key_verifier TEXT NOT NULL CHECK(length(sync_key_verifier) = 43),
  expires_at INTEGER NOT NULL
);
CREATE INDEX account_signups_expiry ON account_signups(expires_at);
