CREATE TABLE IF NOT EXISTS whatsapp_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL DEFAULT 'Tasks',
  is_default boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_boards_account
  ON whatsapp_boards(account_id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_boards_default
  ON whatsapp_boards(account_id)
  WHERE deleted_at IS NULL AND is_default = true;

CREATE TABLE IF NOT EXISTS whatsapp_board_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  board_id uuid NOT NULL REFERENCES whatsapp_boards(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  color varchar(32)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_board_columns_board
  ON whatsapp_board_columns(board_id, order_index)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS whatsapp_board_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  board_id uuid NOT NULL REFERENCES whatsapp_boards(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES whatsapp_board_columns(id) ON DELETE CASCADE,
  title varchar(500) NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  assigned_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES whatsapp_conversations(id) ON DELETE SET NULL,
  due_at timestamptz,
  is_starred boolean NOT NULL DEFAULT false,
  labels jsonb NOT NULL DEFAULT '[]'::jsonb,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover_image_url text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_board_cards_column
  ON whatsapp_board_cards(column_id, order_index)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_board_cards_board
  ON whatsapp_board_cards(board_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_board_cards_conversation
  ON whatsapp_board_cards(conversation_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS whatsapp_board_card_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  card_id uuid NOT NULL REFERENCES whatsapp_board_cards(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  snippet text,
  message_type varchar(40)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_board_card_link_message
  ON whatsapp_board_card_links(card_id, message_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_board_card_links_card
  ON whatsapp_board_card_links(card_id)
  WHERE deleted_at IS NULL;
