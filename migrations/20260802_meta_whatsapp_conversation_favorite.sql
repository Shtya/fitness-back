ALTER TABLE meta_whatsapp_conversations
	ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_meta_wa_conversations_favorite
	ON meta_whatsapp_conversations (is_favorite)
	WHERE is_favorite = true;
