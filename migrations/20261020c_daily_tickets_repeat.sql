-- Daily tickets: tickets that repeat every day, with the outcome of each earlier day kept.
-- Additive only. Run: node scripts/run-sql-migration.mjs migrations/20261020c_daily_tickets_repeat.sql

BEGIN;

ALTER TABLE daily_tickets
  ADD COLUMN IF NOT EXISTS repeat varchar(10) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS history jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
