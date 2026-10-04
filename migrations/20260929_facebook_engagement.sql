-- Facebook Engagement Manager: comment campaigns published through the official Graph API
-- as Pages the user manages. Additive only; safe to re-run.

CREATE TABLE IF NOT EXISTS fb_engagement_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method varchar(16) NOT NULL,
  external_id varchar(64),
  display_name varchar(256),
  encrypted_token text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  status varchar(16) NOT NULL DEFAULT 'connected',
  last_error text,
  last_synced_at timestamptz,
  CONSTRAINT chk_fb_eng_conn_method CHECK (method IN ('oauth', 'token')),
  CONSTRAINT chk_fb_eng_conn_status CHECK (status IN ('connected', 'expired', 'error', 'disconnected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_eng_conn_owner_identity
  ON fb_engagement_connections(owner_user_id, method, external_id)
  WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fb_engagement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES fb_engagement_connections(id) ON DELETE CASCADE,
  type varchar(16) NOT NULL DEFAULT 'page',
  external_id varchar(64) NOT NULL,
  name varchar(256) NOT NULL,
  category varchar(128),
  picture_url text,
  tasks text[] NOT NULL DEFAULT '{}',
  can_publish_comments boolean NOT NULL DEFAULT false,
  encrypted_token text,
  status varchar(16) NOT NULL DEFAULT 'active',
  last_error text,
  last_synced_at timestamptz,
  CONSTRAINT chk_fb_eng_account_type CHECK (type IN ('page')),
  CONSTRAINT chk_fb_eng_account_status CHECK (status IN ('active', 'revoked', 'error')),
  CONSTRAINT uq_fb_eng_account_owner_external UNIQUE (owner_user_id, type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_fb_eng_accounts_connection
  ON fb_engagement_accounts(connection_id);

CREATE TABLE IF NOT EXISTS fb_engagement_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES fb_engagement_accounts(id) ON DELETE CASCADE,
  external_id varchar(128) NOT NULL,
  permalink_url text,
  message text,
  image_url text,
  author_name varchar(256),
  published_at timestamptz,
  reactions_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  shares_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_fb_eng_post_owner_external UNIQUE (owner_user_id, external_id)
);

CREATE TABLE IF NOT EXISTS fb_engagement_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  account_id uuid REFERENCES fb_engagement_accounts(id) ON DELETE SET NULL,
  post_id uuid REFERENCES fb_engagement_posts(id) ON DELETE SET NULL,
  status varchar(24) NOT NULL DEFAULT 'draft',
  pacing_seconds integer NOT NULL DEFAULT 30,
  total_count integer NOT NULL DEFAULT 0,
  published_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  pending_count integer NOT NULL DEFAULT 0,
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT chk_fb_eng_campaign_status CHECK (
    status IN ('draft', 'queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'cancelled')
  ),
  CONSTRAINT chk_fb_eng_campaign_pacing CHECK (pacing_seconds BETWEEN 5 AND 3600)
);

CREATE INDEX IF NOT EXISTS idx_fb_eng_campaigns_owner_created
  ON fb_engagement_campaigns(owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fb_engagement_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES fb_engagement_campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  message text NOT NULL,
  account_id uuid REFERENCES fb_engagement_accounts(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  external_comment_id varchar(128),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_code varchar(64),
  published_at timestamptz,
  CONSTRAINT chk_fb_eng_comment_status CHECK (
    status IN ('draft', 'pending', 'processing', 'published', 'failed', 'cancelled')
  ),
  CONSTRAINT chk_fb_eng_comment_message CHECK (char_length(message) BETWEEN 1 AND 8000)
);

CREATE INDEX IF NOT EXISTS idx_fb_eng_comments_campaign_position
  ON fb_engagement_comments(campaign_id, position);

CREATE INDEX IF NOT EXISTS idx_fb_eng_comments_owner_status
  ON fb_engagement_comments(owner_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS fb_engagement_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES fb_engagement_campaigns(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES fb_engagement_comments(id) ON DELETE CASCADE,
  account_id uuid REFERENCES fb_engagement_accounts(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'queued',
  run_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  locked_at timestamptz,
  locked_by varchar(64),
  last_error text,
  last_error_code varchar(64),
  finished_at timestamptz,
  CONSTRAINT chk_fb_eng_job_status CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_fb_eng_jobs_due
  ON fb_engagement_jobs(run_after)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_fb_eng_jobs_running
  ON fb_engagement_jobs(locked_at)
  WHERE status = 'running';

-- One active job per comment: a comment can never be queued (and published) twice concurrently.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_eng_jobs_active_comment
  ON fb_engagement_jobs(comment_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS fb_engagement_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id uuid,
  campaign_id uuid REFERENCES fb_engagement_campaigns(id) ON DELETE SET NULL,
  comment_id uuid REFERENCES fb_engagement_comments(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  level varchar(16) NOT NULL DEFAULT 'info',
  message text NOT NULL,
  details jsonb,
  CONSTRAINT chk_fb_eng_activity_level CHECK (level IN ('info', 'success', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_fb_eng_activity_owner_created
  ON fb_engagement_activity_logs(owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_fb_eng_activity_campaign_created
  ON fb_engagement_activity_logs(campaign_id, created_at DESC);
