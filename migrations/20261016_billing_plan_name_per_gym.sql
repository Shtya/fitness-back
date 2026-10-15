-- Package names were unique across the whole platform, so two gyms could not both
-- have a "Monthly" package. Make them unique per gym (adminId) instead.
BEGIN;

ALTER TABLE billing_plans DROP CONSTRAINT IF EXISTS "UQ_6007f0b546e36fd85ac96e3b3e8";

CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_plans_owner_name
	ON billing_plans (COALESCE("adminId", '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
	WHERE deleted_at IS NULL;

COMMIT;
