-- Meta WhatsApp Cloud API (Fitness Leads outreach) — separate from WPPConnect WhatsApp module.

CREATE TABLE IF NOT EXISTS meta_whatsapp_config (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	enabled boolean NOT NULL DEFAULT false,
	phone_number_id varchar(64) NULL,
	waba_id varchar(64) NULL,
	display_phone_number varchar(32) NULL,
	verify_token_hash varchar(128) NULL,
	encrypted_credentials text NULL,
	connection_status varchar(32) NOT NULL DEFAULT 'disconnected',
	last_validated_at timestamptz NULL,
	last_error text NULL,
	webhook_path varchar(256) NOT NULL DEFAULT '/api/v1/meta-whatsapp/webhook',
	updated_by uuid NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meta_whatsapp_conversations (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	lead_id uuid NULL,
	wa_id varchar(32) NOT NULL,
	display_name varchar(256) NULL,
	business_name varchar(512) NULL,
	last_message_preview text NULL,
	last_message_at timestamptz NULL,
	last_inbound_at timestamptz NULL,
	unread_count int NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_wa_conversations_wa_id
	ON meta_whatsapp_conversations (wa_id);
CREATE INDEX IF NOT EXISTS idx_meta_wa_conversations_lead
	ON meta_whatsapp_conversations (lead_id);
CREATE INDEX IF NOT EXISTS idx_meta_wa_conversations_last_msg
	ON meta_whatsapp_conversations (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS meta_whatsapp_messages (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	conversation_id uuid NOT NULL REFERENCES meta_whatsapp_conversations(id) ON DELETE CASCADE,
	direction varchar(16) NOT NULL,
	message_type varchar(32) NOT NULL DEFAULT 'text',
	body text NULL,
	template_name varchar(128) NULL,
	template_language varchar(16) NULL,
	template_components jsonb NULL,
	wamid varchar(128) NULL,
	status varchar(32) NOT NULL DEFAULT 'pending',
	error_code varchar(64) NULL,
	error_message text NULL,
	media_id varchar(128) NULL,
	media_mime_type varchar(128) NULL,
	media_file_name varchar(256) NULL,
	media_url text NULL,
	raw_payload jsonb NULL,
	sent_by uuid NULL,
	lead_id uuid NULL,
	provider_timestamp timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_wa_messages_wamid
	ON meta_whatsapp_messages (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meta_wa_messages_conversation
	ON meta_whatsapp_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_meta_wa_messages_lead
	ON meta_whatsapp_messages (lead_id);

CREATE TABLE IF NOT EXISTS meta_whatsapp_bulk_jobs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	status varchar(16) NOT NULL DEFAULT 'queued',
	created_by uuid NULL,
	template_name varchar(128) NOT NULL,
	template_language varchar(16) NOT NULL DEFAULT 'en',
	template_components jsonb NULL,
	total_count int NOT NULL DEFAULT 0,
	sent_count int NOT NULL DEFAULT 0,
	failed_count int NOT NULL DEFAULT 0,
	skipped_count int NOT NULL DEFAULT 0,
	rate_limit_per_minute int NOT NULL DEFAULT 20,
	error_message text NULL,
	started_at timestamptz NULL,
	finished_at timestamptz NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_wa_bulk_jobs_status
	ON meta_whatsapp_bulk_jobs (status);

CREATE TABLE IF NOT EXISTS meta_whatsapp_bulk_items (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	job_id uuid NOT NULL REFERENCES meta_whatsapp_bulk_jobs(id) ON DELETE CASCADE,
	lead_id uuid NULL,
	wa_id varchar(32) NOT NULL,
	display_name varchar(256) NULL,
	status varchar(16) NOT NULL DEFAULT 'queued',
	message_id uuid NULL,
	wamid varchar(128) NULL,
	error_message text NULL,
	attempt_count int NOT NULL DEFAULT 0,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_wa_bulk_items_job
	ON meta_whatsapp_bulk_items (job_id, status);

CREATE TABLE IF NOT EXISTS meta_whatsapp_activity_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	action varchar(64) NOT NULL,
	actor_id uuid NULL,
	details jsonb NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_wa_activity_created
	ON meta_whatsapp_activity_logs (created_at DESC);
