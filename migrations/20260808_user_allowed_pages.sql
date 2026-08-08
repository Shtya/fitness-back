-- Per-user sidebar page allowlist + post-login landing page
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "allowedPages" text[] NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "loginLandingPage" varchar(80) NULL;

COMMENT ON COLUMN users."allowedPages" IS
  'Sidebar nav item ids. NULL/empty = all role pages. Non-empty = only those ids.';

COMMENT ON COLUMN users."loginLandingPage" IS
  'Nav item id opened after login. NULL = role default.';

COMMIT;
