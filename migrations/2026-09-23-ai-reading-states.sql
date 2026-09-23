-- AI Reading Studio cloud state (run on production if synchronize is disabled)
CREATE TABLE IF NOT EXISTS ai_reading_states (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz NULL,
	"userId" uuid NOT NULL,
	books jsonb NOT NULL DEFAULT '[]'::jsonb,
	prompts jsonb NOT NULL DEFAULT '[]'::jsonb,
	topics jsonb NOT NULL DEFAULT '[]'::jsonb,
	journeys jsonb NOT NULL DEFAULT '[]'::jsonb,
	prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
	stats jsonb NOT NULL DEFAULT '{}'::jsonb,
	chat jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reading_user ON ai_reading_states ("userId");
CREATE INDEX IF NOT EXISTS idx_ai_reading_user ON ai_reading_states ("userId");
