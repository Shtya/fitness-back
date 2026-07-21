ALTER TABLE whatsapp_messages
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_forwarded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_mode varchar(20) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS provider_deleted_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_whatsapp_message_deleted_mode'
  ) THEN
    ALTER TABLE whatsapp_messages
      ADD CONSTRAINT chk_whatsapp_message_deleted_mode
      CHECK (deleted_mode IN ('none', 'local', 'everyone'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_starred
  ON whatsapp_messages(conversation_id, is_starred)
  WHERE is_starred = true;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_pinned
  ON whatsapp_messages(conversation_id, is_pinned)
  WHERE is_pinned = true;
