ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS avatar_url varchar(1024);
