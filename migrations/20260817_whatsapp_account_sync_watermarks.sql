ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS initial_hydrated_at timestamptz;

ALTER TABLE whatsapp_accounts
  ADD COLUMN IF NOT EXISTS last_history_sync_at timestamptz;
