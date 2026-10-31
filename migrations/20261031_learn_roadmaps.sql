-- Learn → Roadmaps: learning roadmaps imported from JSON, with per-topic progress.
-- Additive only: one new table. The backend also applies this at startup
-- (src/learn-library/learn-library.schema.ts), so running it by hand is optional.
-- Run: node scripts/run-sql-migration.mjs migrations/20261031_learn_roadmaps.sql

BEGIN;

CREATE TABLE IF NOT EXISTS learn_roadmaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  "userId" uuid NOT NULL,
  title varchar(160) NOT NULL,
  data jsonb NOT NULL,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  "orderIndex" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "IDX_learn_roadmaps_user_order" ON learn_roadmaps ("userId", "orderIndex");

COMMIT;
