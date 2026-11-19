CREATE TABLE account_key_envelopes (
  credential_id TEXT PRIMARY KEY NOT NULL REFERENCES passkeys(id) ON DELETE CASCADE,
  envelope TEXT NOT NULL CHECK(length(envelope) = 80)
);
