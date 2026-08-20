-- Feature-level default models stored on ai_settings (Settings AI tab is the source of truth).

ALTER TABLE ai_settings
	ADD COLUMN IF NOT EXISTS feature_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;
