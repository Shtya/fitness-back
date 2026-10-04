-- Sidebar page access: per-role page modes + per-user overrides (super admin only).
-- Additive only (no change to existing tables); safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS role_page_settings (
  role varchar(32) NOT NULL,
  page_id varchar(64) NOT NULL,
  mode varchar(16) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (role, page_id),
  CONSTRAINT chk_role_page_settings_role CHECK (role IN ('admin', 'coach', 'client')),
  CONSTRAINT chk_role_page_settings_mode CHECK (mode IN ('default', 'optional', 'locked'))
);

CREATE TABLE IF NOT EXISTS user_page_overrides (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  extra_pages text[] NOT NULL DEFAULT '{}',
  locked_pages text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE role_page_settings IS
  'Sidebar page mode per role. Missing row = code default (marketplace pages optional, others shown).';

COMMENT ON TABLE user_page_overrides IS
  'Per-user sidebar overrides on top of the role modes: extra_pages always shown, locked_pages blocked.';

COMMIT;
