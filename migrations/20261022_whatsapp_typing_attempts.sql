-- Customer typing attempts from real WhatsApp chatstate events (composing / recording / paused).
-- No draft text is ever available or stored. Instants are UTC (timestamptz).
-- Also applied idempotently at boot by WhatsAppTypingAttemptsService.

CREATE TABLE IF NOT EXISTS whatsapp_typing_attempts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
	conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
	contact_id uuid NULL REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
	chat_id varchar(160) NULL,
	phone varchar(40) NULL,
	kind varchar(12) NOT NULL DEFAULT 'typing',
	status varchar(16) NOT NULL DEFAULT 'typing',
	started_at timestamptz NOT NULL,
	last_typing_at timestamptz NOT NULL,
	stopped_at timestamptz NULL,
	event_count int NOT NULL DEFAULT 1,
	checkpoint_minutes smallint NOT NULL DEFAULT 0,
	message_id uuid NULL REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
	message_at timestamptz NULL,
	superseded_by uuid NULL,
	closed_at timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_conversation
	ON whatsapp_typing_attempts (conversation_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_account_started
	ON whatsapp_typing_attempts (account_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_typing_attempts_open
	ON whatsapp_typing_attempts (status, last_typing_at)
	WHERE status IN ('typing', 'stopped');

-- At most one live (typing) attempt per conversation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_typing_attempts_live
	ON whatsapp_typing_attempts (conversation_id)
	WHERE status = 'typing';

-- A message can close at most one attempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_typing_attempts_message
	ON whatsapp_typing_attempts (message_id)
	WHERE message_id IS NOT NULL;
