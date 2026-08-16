CREATE TABLE IF NOT EXISTS whatsapp_voice_changer_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL,
  encrypted_api_key text NOT NULL,
  key_last_four varchar(8) NOT NULL,
  CONSTRAINT uq_wa_voice_changer_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_voice_changer_credentials_user
  ON whatsapp_voice_changer_credentials(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_saved_stickers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_hash varchar(64) NOT NULL,
  mime_type varchar(160) NOT NULL,
  file_name varchar(300),
  storage_path varchar(1024) NOT NULL,
  source varchar(20) NOT NULL DEFAULT 'upload',
  is_animated boolean NOT NULL DEFAULT false,
  CONSTRAINT uq_whatsapp_saved_sticker_hash UNIQUE (account_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_saved_stickers_account
  ON whatsapp_saved_stickers(account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_saved_stickers_user
  ON whatsapp_saved_stickers(user_id);

CREATE TABLE IF NOT EXISTS whatsapp_voice_changer_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  configured boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT false,
  provider varchar(32) NOT NULL DEFAULT 'off',
  preset varchar(40) NOT NULL DEFAULT 'deeper',
  pitch_semitones int NOT NULL DEFAULT -5,
  voice_id varchar(120),
  CONSTRAINT uq_whatsapp_voice_changer_settings_user UNIQUE (user_id)
);
