-- Wallet tab: optional deduct-from-available-balance flag on spend / lend entries.
-- Expenses already deducted historically → default true.
-- Lent rows never deducted historically → default false (new UI can still opt in).
-- Run: node scripts/run-sql-migration.mjs migrations/20261016_wallet_affects_balance.sql

BEGIN;

ALTER TABLE wallet_expenses
  ADD COLUMN IF NOT EXISTS affects_balance boolean NOT NULL DEFAULT true;

ALTER TABLE lent_loans
  ADD COLUMN IF NOT EXISTS affects_balance boolean NOT NULL DEFAULT false;

COMMIT;
