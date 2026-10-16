-- Shared smart-document links (public editable view + visit stamps).
-- Run: node scripts/run-sql-migration.mjs migrations/20261016_smart_shared_documents.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS smart_shared_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz NULL,
  token           varchar(40) NOT NULL,
  local_doc_id    varchar(80) NULL,
  owner_user_id   uuid NULL,
  title           varchar(200) NOT NULL DEFAULT 'Untitled',
  content         text NOT NULL DEFAULT '',
  typography      jsonb NULL,
  visits          jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_smart_shared_documents_token
  ON smart_shared_documents (token);

CREATE INDEX IF NOT EXISTS idx_smart_shared_documents_owner_user_id
  ON smart_shared_documents (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_smart_shared_documents_local_owner
  ON smart_shared_documents (local_doc_id, owner_user_id);

COMMIT;
