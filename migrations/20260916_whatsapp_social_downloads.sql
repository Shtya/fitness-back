-- Videos downloaded from social links (TikTok / Instagram / Facebook) found in messages.
-- One row per (message, user, normalized url) so reopening a chat reuses the clip.
CREATE TABLE IF NOT EXISTS whatsapp_social_downloads (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	message_id uuid NOT NULL REFERENCES whatsapp_messages(id) ON DELETE CASCADE,
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	source_url varchar(1024) NOT NULL,
	platform varchar(20) NOT NULL,
	status varchar(20) NOT NULL DEFAULT 'pending',
	title varchar(200),
	storage_path varchar(1024),
	mime_type varchar(160),
	file_size_bytes bigint,
	duration_seconds int,
	error_message text,
	completed_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_social_download_target
	ON whatsapp_social_downloads (message_id, user_id, source_url);

CREATE INDEX IF NOT EXISTS idx_whatsapp_social_downloads_message
	ON whatsapp_social_downloads (message_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_social_downloads_user
	ON whatsapp_social_downloads (user_id);
