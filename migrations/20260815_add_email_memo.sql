-- Gmail → AI Memo → WhatsApp (personal linked-device flow)

CREATE TABLE IF NOT EXISTS email_memo_gmail_connections (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	gmail_address varchar(320) NOT NULL,
	encrypted_tokens text NOT NULL,
	history_id varchar(64) NULL,
	watch_expiration timestamptz NULL,
	connected_at timestamptz NOT NULL DEFAULT now(),
	last_synced_at timestamptz NULL,
	status varchar(32) NOT NULL DEFAULT 'connected',
	last_error text NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_gmail_user
	ON email_memo_gmail_connections (user_id);
CREATE INDEX IF NOT EXISTS idx_email_memo_gmail_address
	ON email_memo_gmail_connections (gmail_address);

CREATE TABLE IF NOT EXISTS email_memo_gmail_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	gmail_connection_id uuid NOT NULL REFERENCES email_memo_gmail_connections(id) ON DELETE CASCADE,
	gmail_message_id varchar(128) NOT NULL,
	thread_id varchar(128) NULL,
	sender_name varchar(320) NULL,
	sender_email varchar(320) NULL,
	subject text NULL,
	snippet text NULL,
	body_text text NULL,
	gmail_url text NULL,
	label_ids jsonb NULL,
	received_at timestamptz NULL,
	processed_at timestamptz NULL,
	status varchar(32) NOT NULL DEFAULT 'RECEIVED',
	skip_reason varchar(64) NULL,
	error_message text NULL,
	attempt_count int NOT NULL DEFAULT 0,
	next_retry_at timestamptz NULL,
	send_after timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_gmail_message
	ON email_memo_gmail_messages (gmail_connection_id, gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_email_memo_gmail_messages_user
	ON email_memo_gmail_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_memo_gmail_messages_status
	ON email_memo_gmail_messages (status, next_retry_at);

CREATE TABLE IF NOT EXISTS email_memo_ai_memos (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	gmail_message_id uuid NOT NULL REFERENCES email_memo_gmail_messages(id) ON DELETE CASCADE,
	provider varchar(32) NOT NULL DEFAULT 'gemini',
	model varchar(80) NULL,
	memo_text text NOT NULL,
	action_text text NULL,
	priority varchar(16) NULL,
	deadline text NULL,
	formatted_message text NOT NULL,
	prompt_version varchar(32) NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_ai_message
	ON email_memo_ai_memos (gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_email_memo_ai_user
	ON email_memo_ai_memos (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_memo_whatsapp_connections (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	status varchar(32) NOT NULL DEFAULT 'disconnected',
	device_name varchar(160) NULL,
	phone_number varchar(32) NULL,
	jid varchar(128) NULL,
	encrypted_session text NULL,
	last_qr_at timestamptz NULL,
	connected_at timestamptz NULL,
	last_error text NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_wa_user
	ON email_memo_whatsapp_connections (user_id);

CREATE TABLE IF NOT EXISTS email_memo_whatsapp_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	gmail_message_id uuid NULL REFERENCES email_memo_gmail_messages(id) ON DELETE SET NULL,
	ai_memo_id uuid NULL REFERENCES email_memo_ai_memos(id) ON DELETE SET NULL,
	chat_id varchar(160) NULL,
	provider_message_id varchar(160) NULL,
	body text NOT NULL,
	status varchar(32) NOT NULL DEFAULT 'queued',
	error_message text NULL,
	attempt_count int NOT NULL DEFAULT 0,
	sent_at timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_memo_wa_messages_user
	ON email_memo_whatsapp_messages (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_memo_wa_messages_gmail
	ON email_memo_whatsapp_messages (gmail_message_id);

CREATE TABLE IF NOT EXISTS email_memo_notification_settings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	process_all_incoming boolean NOT NULL DEFAULT true,
	only_unread boolean NOT NULL DEFAULT false,
	ignore_promotional boolean NOT NULL DEFAULT true,
	ignore_newsletters boolean NOT NULL DEFAULT true,
	gmail_query varchar(512) NULL,
	sender_include jsonb NOT NULL DEFAULT '[]'::jsonb,
	sender_exclude jsonb NOT NULL DEFAULT '[]'::jsonb,
	subject_include jsonb NOT NULL DEFAULT '[]'::jsonb,
	gmail_labels jsonb NOT NULL DEFAULT '["INBOX"]'::jsonb,
	min_priority varchar(16) NOT NULL DEFAULT 'low',
	memo_length varchar(16) NOT NULL DEFAULT 'medium',
	include_sender boolean NOT NULL DEFAULT true,
	include_subject boolean NOT NULL DEFAULT true,
	include_summary boolean NOT NULL DEFAULT true,
	include_action boolean NOT NULL DEFAULT true,
	include_deadline boolean NOT NULL DEFAULT true,
	include_gmail_link boolean NOT NULL DEFAULT true,
	custom_instructions text NULL,
	ai_provider varchar(32) NOT NULL DEFAULT 'gemini',
	ai_model varchar(80) NULL,
	whatsapp_enabled boolean NOT NULL DEFAULT true,
	only_important boolean NOT NULL DEFAULT false,
	notification_mode varchar(24) NOT NULL DEFAULT 'immediate',
	target_chat_id varchar(160) NULL,
	target_chat_name varchar(160) NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_settings_user
	ON email_memo_notification_settings (user_id);

CREATE TABLE IF NOT EXISTS email_memo_processing_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	gmail_message_id uuid NULL REFERENCES email_memo_gmail_messages(id) ON DELETE SET NULL,
	stage varchar(40) NOT NULL,
	level varchar(16) NOT NULL DEFAULT 'info',
	message text NOT NULL,
	meta jsonb NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_memo_logs_user
	ON email_memo_processing_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_memo_logs_message
	ON email_memo_processing_logs (gmail_message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_memo_usage_daily (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL,
	day date NOT NULL,
	emails_processed int NOT NULL DEFAULT 0,
	ai_requests int NOT NULL DEFAULT 0,
	whatsapp_sent int NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_memo_usage_user_day
	ON email_memo_usage_daily (user_id, day);
