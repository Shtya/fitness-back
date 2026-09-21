ALTER TABLE body_measurements
  ADD COLUMN IF NOT EXISTS height numeric(6, 2) NULL,
  ADD COLUMN IF NOT EXISTS "shoulderWidth" numeric(6, 2) NULL,
  ADD COLUMN IF NOT EXISTS inseam numeric(6, 2) NULL,
  ADD COLUMN IF NOT EXISTS unit varchar(8) NOT NULL DEFAULT 'cm',
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS confidence jsonb NULL;
