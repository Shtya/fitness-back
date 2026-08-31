-- The inbox list filters on account_id and sorts by last_message_at DESC NULLS LAST.
-- Only account_id was indexed, so every page paid a sort over the account's
-- whole conversation set. This composite matches the ORDER BY exactly.
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_account_last_message
  ON whatsapp_conversations (account_id, last_message_at DESC NULLS LAST);

-- Attachment prefetch scans pending rows for one account at a time.
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_attachments_download_status
  ON whatsapp_message_attachments (download_status)
  WHERE download_status <> 'downloaded';
