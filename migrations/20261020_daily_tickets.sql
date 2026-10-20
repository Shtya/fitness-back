-- Daily task tickets (WhatsApp idle pane) move from the browser's localStorage to the database,
-- so they follow the user to any device. Each ticket can be split into steps.
-- Additive only. Run: node scripts/run-sql-migration.mjs migrations/20261020_daily_tickets.sql

BEGIN;

CREATE TABLE IF NOT EXISTS daily_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  "userId" uuid NOT NULL,
  no integer NOT NULL,
  title varchar(120) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'todo',
  priority varchar(10) NOT NULL DEFAULT 'medium',
  pinned boolean NOT NULL DEFAULT false,
  steps integer NOT NULL DEFAULT 1,
  progress integer NOT NULL DEFAULT 0,
  day varchar(10) NOT NULL,
  "doneAt" timestamptz NULL,
  "orderIndex" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "IDX_daily_tickets_user_order" ON daily_tickets ("userId", "orderIndex");

COMMIT;
