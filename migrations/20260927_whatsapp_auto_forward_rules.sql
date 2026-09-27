CREATE TABLE IF NOT EXISTS whatsapp_auto_forward_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  target_conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  mode varchar(16) NOT NULL DEFAULT 'forward',
  is_active boolean NOT NULL DEFAULT true,
  forwarded_count integer NOT NULL DEFAULT 0,
  last_forwarded_at timestamptz,
  last_error text,
  CONSTRAINT chk_whatsapp_auto_forward_mode CHECK (mode IN ('forward', 'copy')),
  CONSTRAINT chk_whatsapp_auto_forward_distinct CHECK (source_conversation_id <> target_conversation_id),
  CONSTRAINT uq_whatsapp_auto_forward_rule_pair UNIQUE (source_conversation_id, target_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auto_forward_rules_account
  ON whatsapp_auto_forward_rules(account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auto_forward_rules_source
  ON whatsapp_auto_forward_rules(source_conversation_id);
