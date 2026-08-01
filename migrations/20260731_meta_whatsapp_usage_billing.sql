-- Pricing / billing fields captured from Meta status webhooks (per-message pricing).

ALTER TABLE meta_whatsapp_messages
	ADD COLUMN IF NOT EXISTS pricing_category varchar(32) NULL,
	ADD COLUMN IF NOT EXISTS pricing_type varchar(32) NULL,
	ADD COLUMN IF NOT EXISTS pricing_model varchar(64) NULL,
	ADD COLUMN IF NOT EXISTS billable boolean NULL,
	ADD COLUMN IF NOT EXISTS recipient_country varchar(8) NULL,
	ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 6) NULL;

CREATE INDEX IF NOT EXISTS idx_meta_wa_messages_created_dir
	ON meta_whatsapp_messages (created_at, direction);

CREATE INDEX IF NOT EXISTS idx_meta_wa_messages_pricing_cat
	ON meta_whatsapp_messages (pricing_category)
	WHERE pricing_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_wa_messages_template_name
	ON meta_whatsapp_messages (template_name)
	WHERE template_name IS NOT NULL;
