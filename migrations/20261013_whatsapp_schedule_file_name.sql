-- Original file name for scheduled media. `file_id` is the internal storage key and
-- must not be shown to recipients. Additive and nullable; safe to re-run.
ALTER TABLE whatsapp_message_schedules ADD COLUMN IF NOT EXISTS file_name varchar(255);
