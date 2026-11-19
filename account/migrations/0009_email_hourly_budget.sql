CREATE TABLE account_email_budget (
  window_start INTEGER PRIMARY KEY,
  send_count INTEGER NOT NULL CHECK(send_count > 0)
);
