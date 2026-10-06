-- Allow super_admin rows in role page settings.
BEGIN;

ALTER TABLE role_page_settings DROP CONSTRAINT IF EXISTS chk_role_page_settings_role;
ALTER TABLE role_page_settings
  ADD CONSTRAINT chk_role_page_settings_role
  CHECK (role IN ('super_admin', 'admin', 'coach', 'client'));

COMMIT;
