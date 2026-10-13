-- Who viewed our own stories (from WhatsApp status read receipts).
CREATE TABLE IF NOT EXISTS whatsapp_status_viewers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  status_message_id varchar(200) NOT NULL,
  viewer_key varchar(200) NOT NULL,
  viewed_at timestamptz,
  CONSTRAINT uq_whatsapp_status_viewer UNIQUE (account_id, status_message_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_viewers_status
  ON whatsapp_status_viewers(account_id, status_message_id);

-- One emoji reaction per person per story. `actor_key = 'me'` is this account
-- reacting to someone else's story; any other key is a person reacting to ours.
CREATE TABLE IF NOT EXISTS whatsapp_status_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  status_message_id varchar(200) NOT NULL,
  actor_key varchar(200) NOT NULL,
  emoji varchar(32) NOT NULL,
  message_id uuid REFERENCES whatsapp_messages(id) ON DELETE SET NULL,
  reacted_at timestamptz,
  CONSTRAINT uq_whatsapp_status_reaction_actor UNIQUE (account_id, status_message_id, actor_key)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_reactions_status
  ON whatsapp_status_reactions(account_id, status_message_id);
