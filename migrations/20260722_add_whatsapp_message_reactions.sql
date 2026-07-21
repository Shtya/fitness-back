CREATE TABLE IF NOT EXISTS whatsapp_message_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  message_id uuid NOT NULL,
  actor_key varchar(200) NOT NULL,
  emoji varchar(32) NOT NULL,
  reacted_at timestamptz NULL,
  CONSTRAINT fk_whatsapp_message_reaction_message
    FOREIGN KEY (message_id)
    REFERENCES whatsapp_messages(id)
    ON DELETE CASCADE,
  CONSTRAINT uq_whatsapp_message_reaction_actor
    UNIQUE (message_id, actor_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_reactions_message_id
  ON whatsapp_message_reactions(message_id);
