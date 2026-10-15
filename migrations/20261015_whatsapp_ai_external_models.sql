-- External (bring-your-own-key) AI models per WhatsApp account, usable by the AI agent.
-- API keys are stored AES-256-GCM encrypted (AiCryptoService); only the last 4 chars are exposed.
CREATE TABLE IF NOT EXISTS whatsapp_ai_external_models (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	label varchar(80) NOT NULL,
	kind varchar(30) NOT NULL DEFAULT 'openai_compatible',
	preset varchar(30) NOT NULL DEFAULT 'custom',
	base_url varchar(300) NOT NULL,
	model varchar(160) NOT NULL,
	encrypted_api_key text,
	key_last4 varchar(4),
	is_active boolean NOT NULL DEFAULT true,
	last_test_at timestamptz,
	last_test_ok boolean,
	last_test_message varchar(300),
	created_by uuid REFERENCES users(id) ON DELETE SET NULL,
	updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_external_models_account
	ON whatsapp_ai_external_models(account_id);

ALTER TABLE whatsapp_ai_agent_settings
	ADD COLUMN IF NOT EXISTS external_model_id uuid REFERENCES whatsapp_ai_external_models(id) ON DELETE SET NULL;
