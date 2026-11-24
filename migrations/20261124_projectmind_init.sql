-- ProjectMind AI module — initial schema (additive only).
-- Creates pm_* tables. Does NOT alter or drop any existing So7baFit table.
-- Apply manually (this repo uses reviewed SQL migrations, TypeORM synchronize is off):
--   psql "$DATABASE_URL" -f migrations/20261124_projectmind_init.sql
-- Idempotent: safe to run twice.

BEGIN;

CREATE TABLE IF NOT EXISTS pm_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,                 -- tenantId || adminId || userId (same rule as AiService.workspaceId)
  created_by    uuid NOT NULL,
  name          varchar(160) NOT NULL,
  description   text,
  source_type   varchar(16)  NOT NULL DEFAULT 'zip',      -- zip | github
  source_url    varchar(500),
  branch        varchar(200),
  status        varchar(16)  NOT NULL DEFAULT 'draft',    -- draft | importing | analyzing | ready | failed
  status_message text,
  progress      integer NOT NULL DEFAULT 0,
  commit_sha    varchar(64),
  file_count    integer NOT NULL DEFAULT 0,
  chunk_count   integer NOT NULL DEFAULT 0,
  total_bytes   bigint  NOT NULL DEFAULT 0,
  languages     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  analysis      jsonb   NOT NULL DEFAULT '{}'::jsonb,
  analyzed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pm_projects_workspace ON pm_projects (workspace_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS pm_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  path           varchar(1000) NOT NULL,
  language       varchar(32),
  size_bytes     integer NOT NULL DEFAULT 0,
  line_count     integer NOT NULL DEFAULT 0,
  content        text,                          -- NULL when excluded
  excluded       boolean NOT NULL DEFAULT false,
  exclude_reason varchar(64),
  symbols        jsonb NOT NULL DEFAULT '[]'::jsonb,
  imports        jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (project_id, path)
);
CREATE INDEX IF NOT EXISTS idx_pm_files_project ON pm_files (project_id);

CREATE TABLE IF NOT EXISTS pm_chunks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES pm_files(id) ON DELETE CASCADE,
  path        varchar(1000) NOT NULL,
  start_line  integer NOT NULL,
  end_line    integer NOT NULL,
  text        text NOT NULL,
  symbols     text NOT NULL DEFAULT '',
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('simple', coalesce(path,'') || ' ' || coalesce(symbols,'') || ' ' || coalesce(text,''))
              ) STORED
);
CREATE INDEX IF NOT EXISTS idx_pm_chunks_project ON pm_chunks (project_id);
CREATE INDEX IF NOT EXISTS idx_pm_chunks_tsv ON pm_chunks USING gin (tsv);

CREATE TABLE IF NOT EXISTS pm_conversations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  title        varchar(200) NOT NULL DEFAULT 'New conversation',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_conv_project ON pm_conversations (project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS pm_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES pm_conversations(id) ON DELETE CASCADE,
  role            varchar(12) NOT NULL,           -- user | assistant
  content         text NOT NULL,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- sources, verification, confidence, model, latency
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_msg_conv ON pm_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS pm_doc_sections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  key          varchar(48) NOT NULL,
  title        varchar(200) NOT NULL,
  content_md   text NOT NULL DEFAULT '',
  origin       varchar(12) NOT NULL DEFAULT 'generated',  -- generated | ai | edited
  verification varchar(12) NOT NULL DEFAULT 'verified',   -- verified | inferred | unverified
  commit_sha   varchar(64),
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE TABLE IF NOT EXISTS pm_knowledge_gaps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  dedupe_key    varchar(200) NOT NULL,
  title         varchar(300) NOT NULL,
  description   text,
  priority      varchar(10) NOT NULL DEFAULT 'medium',     -- low | medium | high | critical
  status        varchar(14) NOT NULL DEFAULT 'not_started',-- not_started | investigating | understood | documented | resolved
  source        varchar(10) NOT NULL DEFAULT 'auto',       -- auto | manual | chat
  related_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_pm_gaps_project ON pm_knowledge_gaps (project_id, status);

CREATE TABLE IF NOT EXISTS pm_meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  workspace_id     uuid NOT NULL,
  user_id          uuid NOT NULL,
  title            varchar(200) NOT NULL,
  scheduled_at     timestamptz,
  status           varchar(12) NOT NULL DEFAULT 'planned', -- planned | live | done
  recording_status varchar(12) NOT NULL DEFAULT 'none',    -- none only, until an STT source is configured
  prep             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_meetings_project ON pm_meetings (project_id, scheduled_at);

CREATE TABLE IF NOT EXISTS pm_meeting_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES pm_meetings(id) ON DELETE CASCADE,
  kind       varchar(12) NOT NULL,                         -- question | answer | decision | follow_up | unresolved
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_notes_meeting ON pm_meeting_notes (meeting_id, created_at);

CREATE TABLE IF NOT EXISTS pm_sim_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES pm_projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  user_id      uuid NOT NULL,
  scenario     varchar(24) NOT NULL,
  difficulty   varchar(10) NOT NULL DEFAULT 'medium',
  status       varchar(12) NOT NULL DEFAULT 'active',      -- active | completed
  total_score  integer,
  summary      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pm_sim_project ON pm_sim_sessions (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pm_sim_turns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL REFERENCES pm_sim_sessions(id) ON DELETE CASCADE,
  idx          integer NOT NULL,
  question     text NOT NULL,
  answer       text,
  scores       jsonb NOT NULL DEFAULT '{}'::jsonb,
  total        integer,
  feedback     text,
  ideal_answer text,
  follow_up    text,
  UNIQUE (session_id, idx)
);

CREATE TABLE IF NOT EXISTS pm_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id      uuid,
  project_id   uuid,
  action       varchar(48) NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_audit_ws ON pm_audit_logs (workspace_id, created_at DESC);

COMMIT;
