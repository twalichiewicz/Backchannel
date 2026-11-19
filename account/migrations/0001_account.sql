CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL
);
CREATE INDEX passkeys_account ON passkeys(account_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE ceremonies (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  account_id TEXT,
  session_hash TEXT REFERENCES sessions(token_hash) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ceremonies_session ON ceremonies(session_hash);
CREATE INDEX ceremonies_expiry ON ceremonies(expires_at);

CREATE TABLE snapshots (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  ciphertext TEXT NOT NULL
);
