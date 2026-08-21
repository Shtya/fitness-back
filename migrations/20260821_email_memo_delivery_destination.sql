-- Email Memo: deliver memos inside the WhatsApp CRM as a pinned "AI" chat
ALTER TABLE email_memo_notification_settings
	ADD COLUMN IF NOT EXISTS delivery_destination varchar(24) NOT NULL DEFAULT 'whatsapp';

COMMENT ON COLUMN email_memo_notification_settings.delivery_destination IS
	'whatsapp | in_site | both — where summarized memos are delivered';
