-- Learn: English courses. Additive and idempotent (also applied at boot by LearnLibraryService).
ALTER TABLE learn_courses ADD COLUMN IF NOT EXISTS kind varchar(16) NOT NULL DEFAULT 'general';
ALTER TABLE learn_lectures ADD COLUMN IF NOT EXISTS english jsonb NOT NULL DEFAULT '{}'::jsonb;
