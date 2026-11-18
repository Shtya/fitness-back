-- Which pocket pays an expense: cash on hand (default), mobile wallet or bank.
-- The API also adds this column at boot; this file is for environments that run migrations.
-- Run: node scripts/run-sql-migration.mjs migrations/20261118_wallet_expense_pocket.sql

BEGIN;

ALTER TABLE wallet_expenses
  ADD COLUMN IF NOT EXISTS pocket varchar(10) NOT NULL DEFAULT 'cash';

COMMIT;
