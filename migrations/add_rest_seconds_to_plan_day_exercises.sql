-- Add rest_seconds column to exercise_plan_day_exercises
-- Run this migration if your DB doesn't auto-sync schema

ALTER TABLE exercise_plan_day_exercises
ADD COLUMN IF NOT EXISTS rest_seconds INTEGER NULL;
