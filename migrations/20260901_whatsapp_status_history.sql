CREATE TABLE IF NOT EXISTS whatsapp_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  provider_status_id varchar(300) NOT NULL,
  sender_wa_id varchar(160),
  type varchar(40) NOT NULL,
  caption text,
  is_own boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL,
  expires_at timestamptz,
  media_path varchar(1024),
  archived_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_whatsapp_status_history_account_provider UNIQUE (account_id, provider_status_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_history_account
  ON whatsapp_status_history(account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_history_sender
  ON whatsapp_status_history(account_id, sender_wa_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_status_history_published
  ON whatsapp_status_history(account_id, published_at DESC);
