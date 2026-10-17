-- Wallet tab: mark money / spend rows as monthly recurring for next-month forecast.
-- income_entries already has `recurring`; expected_entries and wallet_expenses need it.
-- Run: node scripts/run-sql-migration.mjs migrations/20261017_wallet_recurring.sql

BEGIN;

ALTER TABLE expected_entries
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;

ALTER TABLE wallet_expenses
  ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;

COMMIT;
