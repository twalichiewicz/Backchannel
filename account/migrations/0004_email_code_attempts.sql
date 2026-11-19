ALTER TABLE account_email_codes ADD COLUMN verification_id TEXT;
ALTER TABLE account_email_codes ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX account_email_codes_verification ON account_email_codes(verification_id) WHERE verification_id IS NOT NULL;
