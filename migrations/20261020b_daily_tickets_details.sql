-- Daily tickets: free-text notes and a checklist inside each ticket.
-- Additive only. Run: node scripts/run-sql-migration.mjs migrations/20261020b_daily_tickets_details.sql

BEGIN;

ALTER TABLE daily_tickets
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
