BEGIN;

CREATE TABLE IF NOT EXISTS calorie_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" uuid NOT NULL,
  name varchar(120) NOT NULL,
  sex varchar(16) NOT NULL,
  age integer NOT NULL,
  height numeric NOT NULL,
  weight numeric NOT NULL,
  "bodyFat" numeric,
  activity varchar(16) NOT NULL,
  goal varchar(8) NOT NULL,
  targets jsonb NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calorie_calculations_owner
  ON calorie_calculations ("ownerId", "createdAt" DESC);

COMMIT;
