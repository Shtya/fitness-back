ALTER TABLE whatsapp_ai_settings
  ADD COLUMN IF NOT EXISTS prompt_presets jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE whatsapp_ai_settings
  ADD COLUMN IF NOT EXISTS active_prompt_id uuid;

ALTER TABLE whatsapp_ai_settings
  DROP CONSTRAINT IF EXISTS ck_whatsapp_ai_settings_prompt_presets;

ALTER TABLE whatsapp_ai_settings
  ADD CONSTRAINT ck_whatsapp_ai_settings_prompt_presets
  CHECK (jsonb_typeof(prompt_presets) = 'array' AND jsonb_array_length(prompt_presets) <= 20);
