-- Wallet tab: money the user lent to someone (still owed back).
-- Run: node scripts/run-sql-migration.mjs migrations/20261016_lent_loans.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lent_loans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person      varchar(120) NOT NULL,
  amount      numeric(12,2) NOT NULL CHECK (amount > 0),
  lent_date   date NOT NULL,
  notes       text NULL
);

CREATE INDEX IF NOT EXISTS idx_lent_loans_user_id ON lent_loans (user_id);
CREATE INDEX IF NOT EXISTS idx_lent_loans_lent_date ON lent_loans (lent_date);

COMMIT;
