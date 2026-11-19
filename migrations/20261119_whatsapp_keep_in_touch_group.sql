-- Keep in touch groups: friends, family, acquaintances, unknown (NULL = not sorted yet).
-- WhatsAppSchemaService also applies this at boot.
ALTER TABLE whatsapp_conversation_preferences
	ADD COLUMN IF NOT EXISTS keep_in_touch_group varchar(16);
