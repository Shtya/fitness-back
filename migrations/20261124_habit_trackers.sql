-- Habits tab (Today's tickets): one row per user. Also created at boot by HabitsService.
CREATE TABLE IF NOT EXISTS habit_trackers (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	deleted_at timestamptz NULL,
	"userId" uuid NOT NULL,
	habits jsonb NOT NULL DEFAULT '[]'::jsonb,
	cards jsonb NOT NULL DEFAULT '[]'::jsonb,
	"planStart" varchar(10) NOT NULL DEFAULT '',
	CONSTRAINT uq_habit_tracker_user UNIQUE ("userId")
);
