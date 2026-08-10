-- Learning OS cloud state (run on production if synchronize is disabled)
CREATE TABLE IF NOT EXISTS learning_states (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz NULL,
	"userId" uuid NOT NULL,
	paths jsonb NOT NULL DEFAULT '[]'::jsonb,
	inbox jsonb NOT NULL DEFAULT '[]'::jsonb,
	activity jsonb NOT NULL DEFAULT '[]'::jsonb,
	stats jsonb NOT NULL DEFAULT '{}'::jsonb,
	"continueLearning" jsonb NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_learning_user ON learning_states ("userId");
CREATE INDEX IF NOT EXISTS idx_learning_user ON learning_states ("userId");
