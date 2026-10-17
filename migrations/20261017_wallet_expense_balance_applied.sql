-- Defer balance deduction until spent_date is due (e.g. salary dated next month).
-- Existing rows already hit the wallet → mark them applied.
-- Run: node scripts/run-sql-migration.mjs migrations/20261017_wallet_expense_balance_applied.sql

BEGIN;

ALTER TABLE wallet_expenses
  ADD COLUMN IF NOT EXISTS balance_applied boolean NOT NULL DEFAULT false;

UPDATE wallet_expenses
SET balance_applied = true
WHERE affects_balance = true
  AND balance_applied = false;

COMMIT;
