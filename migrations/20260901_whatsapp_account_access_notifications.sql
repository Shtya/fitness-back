ALTER TABLE whatsapp_account_access
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;
