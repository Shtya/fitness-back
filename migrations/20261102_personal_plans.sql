-- My Workouts: a client allowed to edit their workout ("canEditWorkout") edits a personal copy
-- of the coach's plan, never the coach's plan itself. "reset" points them back to the original.
--   ownerUserId  — set only on such a copy (the client it belongs to); coach lists skip these rows
--   sourcePlanId — the coach plan the copy was made from
-- Additive only. The backend also applies these statements at startup
-- (src/plans/personal-plan.schema.ts), so running this file by hand is optional.
ALTER TABLE exercise_plans ADD COLUMN IF NOT EXISTS "ownerUserId" uuid NULL;
ALTER TABLE exercise_plans ADD COLUMN IF NOT EXISTS "sourcePlanId" uuid NULL;
CREATE INDEX IF NOT EXISTS "IDX_exercise_plans_owner_user" ON exercise_plans ("ownerUserId");
