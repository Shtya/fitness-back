CREATE TABLE IF NOT EXISTS whatsapp_conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_notes_conversation_id
  ON whatsapp_conversation_notes(conversation_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_notes_author_user_id
  ON whatsapp_conversation_notes(author_user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_notes_conversation
  ON whatsapp_conversation_notes(conversation_id, created_at);
