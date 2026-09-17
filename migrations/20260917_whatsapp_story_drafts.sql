-- Videos staged for publishing as WhatsApp stories.
-- A long video becomes several clips, reviewed before anything is published; each
-- part keeps its own status so a partially published sequence can resume.
CREATE TABLE IF NOT EXISTS whatsapp_story_drafts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	account_id uuid NOT NULL,
	source_attachment_id uuid,
	source_label varchar(200),
	status varchar(20) NOT NULL DEFAULT 'draft',
	total_duration_seconds double precision NOT NULL DEFAULT 0,
	caption text,
	parts jsonb NOT NULL DEFAULT '[]'::jsonb,
	error_message text,
	published_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_story_drafts_user
	ON whatsapp_story_drafts (user_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_story_drafts_account
	ON whatsapp_story_drafts (account_id);
