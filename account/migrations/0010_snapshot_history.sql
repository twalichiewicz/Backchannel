CREATE TABLE account_snapshot_history (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  ciphertext TEXT NOT NULL
);
