-- Wallet tab: gold the user owns, stored in grams + karat and valued daily at the market price.
-- Run: node scripts/run-sql-migration.mjs migrations/20261015_gold_holdings.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS gold_holdings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz NULL,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        varchar(120) NOT NULL,
  grams       numeric(10,3) NOT NULL CHECK (grams > 0),
  karat       smallint NOT NULL DEFAULT 21 CHECK (karat IN (24, 22, 21, 18)),
  notes       text NULL
);

CREATE INDEX IF NOT EXISTS idx_gold_holdings_user_id ON gold_holdings (user_id);

COMMIT;
