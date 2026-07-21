CREATE TABLE IF NOT EXISTS whatsapp_ai_settings (
  account_id uuid PRIMARY KEY REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  provider varchar(40) NOT NULL DEFAULT 'dragify-free',
  model varchar(80) NOT NULL DEFAULT 'auto',
  system_prompt text,
  persona text,
  language varchar(10) NOT NULL DEFAULT 'auto',
  tone varchar(20) NOT NULL DEFAULT 'professional',
  suggestion_count smallint NOT NULL DEFAULT 3,
  context_message_limit smallint NOT NULL DEFAULT 20,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_whatsapp_ai_settings_provider
    CHECK (provider IN ('dragify-free')),
  CONSTRAINT ck_whatsapp_ai_settings_language
    CHECK (language IN ('auto', 'ar', 'en')),
  CONSTRAINT ck_whatsapp_ai_settings_tone
    CHECK (tone IN ('professional', 'friendly', 'egyptian', 'sales', 'support', 'concise')),
  CONSTRAINT ck_whatsapp_ai_settings_suggestion_count
    CHECK (suggestion_count BETWEEN 1 AND 5),
  CONSTRAINT ck_whatsapp_ai_settings_context_limit
    CHECK (context_message_limit BETWEEN 5 AND 50)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_settings_updated_by
  ON whatsapp_ai_settings(updated_by);
