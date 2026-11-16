-- "Keep in touch" (صلة رحم): per-user reminder to message a person every N days.
-- NULL = the chat is not tracked. The last contact is read from the last outbound message,
-- so no extra column is needed for it. WhatsAppSchemaService also applies this at boot.
ALTER TABLE whatsapp_conversation_preferences
	ADD COLUMN IF NOT EXISTS keep_in_touch_days int;
