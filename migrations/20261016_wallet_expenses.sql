-- Wallet tab: money the user spent (name + amount + date).
-- Run: node scripts/run-sql-migration.mjs migrations/20261016_wallet_expenses.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS wallet_expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(180) NOT NULL,
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  spent_date  date NOT NULL,
  notes       text NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_expenses_user_id ON wallet_expenses (user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_expenses_spent_date ON wallet_expenses (spent_date);

COMMIT;
