-- Follow-up: FK users.tenantId -> tenants.id
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_users_tenant' AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_tenant
      FOREIGN KEY ("tenantId") REFERENCES tenants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
