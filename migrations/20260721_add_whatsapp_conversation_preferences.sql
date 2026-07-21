CREATE TABLE IF NOT EXISTS whatsapp_conversation_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_favorite boolean NOT NULL DEFAULT false,
  is_pinned boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_conversation_preference UNIQUE (conversation_id, user_id)
);

ALTER TABLE whatsapp_conversation_preferences
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_preferences_conversation
  ON whatsapp_conversation_preferences(conversation_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_preferences_user
  ON whatsapp_conversation_preferences(user_id);
