ALTER TABLE whatsapp_conversation_preferences
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

UPDATE whatsapp_conversation_preferences
SET pinned_at = COALESCE(updated_at, created_at, now())
WHERE is_pinned = true
  AND pinned_at IS NULL;
