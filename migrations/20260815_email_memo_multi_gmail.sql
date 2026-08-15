-- Multiple Gmail accounts + OAuth verification flag
ALTER TABLE IF EXISTS email_memo_gmail_connections
	DROP CONSTRAINT IF EXISTS uq_email_memo_gmail_user;
DROP INDEX IF EXISTS uq_email_memo_gmail_user;

CREATE INDEX IF NOT EXISTS idx_email_memo_gmail_user
	ON email_memo_gmail_connections (user_id);

ALTER TABLE IF EXISTS email_memo_gmail_connections
	ADD COLUMN IF NOT EXISTS oauth_verified_at timestamptz NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_gmail_user_address
	ON email_memo_gmail_connections (user_id, gmail_address)
	WHERE gmail_address IS NOT NULL;
