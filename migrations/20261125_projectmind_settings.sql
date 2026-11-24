-- ProjectMind: per-workspace settings (currently the saved GitHub access token, encrypted at rest).
-- Additive only. Idempotent. Apply after 20261124_projectmind_init.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS pm_settings (
  workspace_id        uuid PRIMARY KEY,
  github_token_enc    text,                 -- AES-256-GCM (same key derivation as the AI module); never returned by the API
  github_token_last4  varchar(8),
  updated_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMIT;
