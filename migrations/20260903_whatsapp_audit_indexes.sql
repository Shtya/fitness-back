-- WhatsApp audit follow-up: report/group lookups + preference identity uniqueness.

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sender_wa_id
  ON whatsapp_messages (sender_wa_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_assignments_assigned_user
  ON whatsapp_conversation_assignments (assigned_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_conv_pref_account_chat_user
  ON whatsapp_conversation_preferences (account_id, provider_chat_id, user_id)
  WHERE account_id IS NOT NULL AND provider_chat_id IS NOT NULL;
