/**
 * Mirrors migrations/20261102_personal_plans.sql. Applied at boot (production runs with
 * TypeORM synchronize off) and before any plan query, because ExercisePlan now selects these
 * columns. Additive only: two nullable columns and an index, existing rows are untouched.
 */
export const PERSONAL_PLAN_SCHEMA_STATEMENTS = [
	`ALTER TABLE exercise_plans ADD COLUMN IF NOT EXISTS "ownerUserId" uuid NULL`,
	`ALTER TABLE exercise_plans ADD COLUMN IF NOT EXISTS "sourcePlanId" uuid NULL`,
	`CREATE INDEX IF NOT EXISTS "IDX_exercise_plans_owner_user" ON exercise_plans ("ownerUserId")`,
];
