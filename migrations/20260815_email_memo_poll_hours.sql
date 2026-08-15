ALTER TABLE IF EXISTS email_memo_notification_settings
	ADD COLUMN IF NOT EXISTS poll_interval_hours int NOT NULL DEFAULT 1;
