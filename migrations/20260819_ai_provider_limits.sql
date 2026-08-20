ALTER TABLE ai_settings
	ADD COLUMN IF NOT EXISTS provider_limits jsonb NOT NULL DEFAULT '{}'::jsonb;
