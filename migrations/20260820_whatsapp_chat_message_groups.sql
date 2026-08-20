CREATE TABLE IF NOT EXISTS whatsapp_chat_message_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_chat_message_groups_name
  ON whatsapp_chat_message_groups (conversation_id, user_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_groups_conversation
  ON whatsapp_chat_message_groups(conversation_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_groups_user
  ON whatsapp_chat_message_groups(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_chat_message_group_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  group_id uuid NOT NULL REFERENCES whatsapp_chat_message_groups(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_chat_message_group_item_message
  ON whatsapp_chat_message_group_items (message_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_group_items_group
  ON whatsapp_chat_message_group_items(group_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_chat_message_group_items_conversation
  ON whatsapp_chat_message_group_items(conversation_id);
