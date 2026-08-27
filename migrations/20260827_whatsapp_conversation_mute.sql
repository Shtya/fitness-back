ALTER TABLE whatsapp_conversation_preferences
  ADD COLUMN IF NOT EXISTS is_muted boolean NOT NULL DEFAULT false;
