-- Email Memo GUI credentials + WhatsApp account link
ALTER TABLE IF EXISTS email_memo_gmail_connections
	ALTER COLUMN gmail_address DROP NOT NULL;
ALTER TABLE IF EXISTS email_memo_gmail_connections
	ALTER COLUMN encrypted_tokens DROP NOT NULL;
ALTER TABLE IF EXISTS email_memo_gmail_connections
	ADD COLUMN IF NOT EXISTS encrypted_oauth_app text NULL;
ALTER TABLE IF EXISTS email_memo_whatsapp_connections
	ADD COLUMN IF NOT EXISTS whatsapp_account_id uuid NULL;
ALTER TABLE IF EXISTS email_memo_whatsapp_connections
	ADD COLUMN IF NOT EXISTS dedicated_account boolean NOT NULL DEFAULT true;
