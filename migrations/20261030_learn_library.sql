-- "Learn" tab on the WhatsApp page: a personal library of courses and lectures (content written
-- with the Documents editor, plus notes, key points, summary, Q&A and revision flags).
-- Additive only: two new tables, nothing existing is touched.
-- Run: node scripts/run-sql-migration.mjs migrations/20261030_learn_library.sql

BEGIN;

CREATE TABLE IF NOT EXISTS learn_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  "userId" uuid NOT NULL,
  title varchar(160) NOT NULL,
  description text NOT NULL DEFAULT '',
  category varchar(60) NOT NULL DEFAULT '',
  color varchar(16) NOT NULL DEFAULT 'green',
  pinned boolean NOT NULL DEFAULT false,
  "orderIndex" integer NOT NULL DEFAULT 0,
  "lastStudiedAt" timestamptz NULL
);

CREATE INDEX IF NOT EXISTS "IDX_learn_courses_user_order" ON learn_courses ("userId", "orderIndex");

CREATE TABLE IF NOT EXISTS learn_lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  "userId" uuid NOT NULL,
  "courseId" uuid NOT NULL,
  title varchar(160) NOT NULL,
  description text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  "keyPoints" text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  qa jsonb NOT NULL DEFAULT '[]'::jsonb,
  done boolean NOT NULL DEFAULT false,
  "doneAt" timestamptz NULL,
  "needsRevision" boolean NOT NULL DEFAULT false,
  "orderIndex" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "IDX_learn_lectures_user_course_order" ON learn_lectures ("userId", "courseId", "orderIndex");

COMMIT;
