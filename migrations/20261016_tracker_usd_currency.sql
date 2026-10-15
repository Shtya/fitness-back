-- Wallet tracker: store USD amounts until received, then lock EGP at that day's rate.
-- Run: node scripts/run-sql-migration.mjs migrations/20261016_tracker_usd_currency.sql

BEGIN;

ALTER TABLE expected_entries
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'EGP';

ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'EGP';

ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS original_amount numeric(12,2) NULL;

ALTER TABLE income_entries
  ADD COLUMN IF NOT EXISTS fx_rate numeric(12,6) NULL;

COMMIT;
