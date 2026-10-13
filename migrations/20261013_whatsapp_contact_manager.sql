-- Contact manager: user-entered name/notes, WhatsApp registration check, and the
-- state of writing the contact into the linked WhatsApp account's contact list.
-- `name` keeps the WhatsApp-sourced label. Additive and nullable/defaulted; safe to re-run.
ALTER TABLE whatsapp_contacts
	ADD COLUMN IF NOT EXISTS local_name varchar(200),
	ADD COLUMN IF NOT EXISTS notes text,
	ADD COLUMN IF NOT EXISTS is_saved boolean NOT NULL DEFAULT false,
	ADD COLUMN IF NOT EXISTS source varchar(20) NOT NULL DEFAULT 'whatsapp',
	ADD COLUMN IF NOT EXISTS saved_by_user_id uuid,
	ADD COLUMN IF NOT EXISTS wa_registration varchar(20),
	ADD COLUMN IF NOT EXISTS wa_checked_at timestamptz,
	ADD COLUMN IF NOT EXISTS wa_sync_status varchar(20) NOT NULL DEFAULT 'not_requested',
	ADD COLUMN IF NOT EXISTS wa_sync_op varchar(10),
	ADD COLUMN IF NOT EXISTS wa_sync_error varchar(300),
	ADD COLUMN IF NOT EXISTS wa_sync_attempts int NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS wa_sync_next_at timestamptz,
	ADD COLUMN IF NOT EXISTS wa_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_saved
	ON whatsapp_contacts(account_id) WHERE is_saved = true;

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_sync_due
	ON whatsapp_contacts(wa_sync_next_at) WHERE wa_sync_status IN ('pending', 'failed', 'syncing');
