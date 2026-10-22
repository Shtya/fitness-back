-- WhatsApp page lock: a per-user password that guards the WhatsApp workspace screen.
-- Also applied idempotently at boot by WhatsAppPageLockService (src/whatsapp/utils/whatsapp-page-lock.ts).
CREATE TABLE IF NOT EXISTS whatsapp_page_locks (
	user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	passcode_hash text,
	enabled boolean NOT NULL DEFAULT false,
	auto_lock_minutes smallint NOT NULL DEFAULT 5,
	lock_on_hide boolean NOT NULL DEFAULT false,
	lock_on_open boolean NOT NULL DEFAULT false,
	failed_attempts smallint NOT NULL DEFAULT 0,
	locked_until timestamptz,
	reset_code_hash text,
	reset_code_expires timestamptz,
	reset_code_sent_at timestamptz,
	reset_code_attempts smallint NOT NULL DEFAULT 0
);
