ALTER TABLE whatsapp_conversation_preferences
  ADD COLUMN IF NOT EXISTS account_id uuid,
  ADD COLUMN IF NOT EXISTS provider_chat_id varchar(160);

UPDATE whatsapp_conversation_preferences p
SET
  account_id = c.account_id,
  provider_chat_id = c.provider_chat_id
FROM whatsapp_conversations c
WHERE c.id = p.conversation_id
  AND (p.account_id IS NULL OR p.provider_chat_id IS NULL);

DELETE FROM whatsapp_conversation_preferences a
USING whatsapp_conversation_preferences b
WHERE a.id > b.id
  AND a.user_id = b.user_id
  AND a.account_id IS NOT DISTINCT FROM b.account_id
  AND a.provider_chat_id IS NOT DISTINCT FROM b.provider_chat_id
  AND a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND a.account_id IS NOT NULL
  AND a.provider_chat_id IS NOT NULL;

ALTER TABLE whatsapp_conversation_preferences
  ALTER COLUMN conversation_id DROP NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ANY (con.conkey)
  WHERE con.conrelid = 'whatsapp_conversation_preferences'::regclass
    AND con.contype = 'f'
    AND att.attname = 'conversation_id'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE whatsapp_conversation_preferences DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;
END $$;

ALTER TABLE whatsapp_conversation_preferences
  ADD CONSTRAINT fk_whatsapp_conversation_preferences_conversation
  FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_whatsapp_conversation_preferences_account'
  ) THEN
    ALTER TABLE whatsapp_conversation_preferences
      ADD CONSTRAINT fk_whatsapp_conversation_preferences_account
      FOREIGN KEY (account_id) REFERENCES whatsapp_accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_conversation_preference_identity
  ON whatsapp_conversation_preferences (user_id, account_id, provider_chat_id)
  WHERE deleted_at IS NULL
    AND account_id IS NOT NULL
    AND provider_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_preferences_identity
  ON whatsapp_conversation_preferences (account_id, provider_chat_id);
