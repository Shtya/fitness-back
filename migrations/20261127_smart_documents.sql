-- Documents editor: keep each user's documents in the database (the browser copy is only a cache).
-- Additive only. Idempotent.
BEGIN;
CREATE TABLE IF NOT EXISTS smart_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id      uuid NOT NULL,
  client_id          varchar(80) NOT NULL,          -- the editor's own id (d_…)
  title              varchar(200) NOT NULL DEFAULT 'Untitled',
  title_locked       boolean NOT NULL DEFAULT false,
  content            text NOT NULL DEFAULT '',
  client_updated_at  timestamptz NOT NULL,          -- when the writer last changed it
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS smart_documents_owner_client_uq ON smart_documents (owner_user_id, client_id);
CREATE INDEX IF NOT EXISTS smart_documents_owner_updated_idx ON smart_documents (owner_user_id, client_updated_at DESC);
COMMIT;
