-- Independent AI module: model registry, encrypted provider keys, usage, monthly limits.

CREATE TABLE IF NOT EXISTS ai_settings (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL,
	timezone varchar(80) NOT NULL DEFAULT 'Africa/Cairo',
	monthly_cost_limit numeric(12, 6) NOT NULL DEFAULT 20,
	monthly_request_limit int NOT NULL DEFAULT 1000,
	monthly_image_limit int NOT NULL DEFAULT 100,
	safety_buffer_percent numeric(5, 2) NOT NULL DEFAULT 0,
	warnings_enabled boolean NOT NULL DEFAULT true,
	feature_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_settings_workspace ON ai_settings (workspace_id);

CREATE TABLE IF NOT EXISTS ai_provider_credentials (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL,
	provider varchar(40) NOT NULL,
	encrypted_api_key text NOT NULL,
	key_last4 varchar(4) NULL,
	verified_at timestamptz NULL,
	updated_by uuid NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_credentials_workspace_provider
	ON ai_provider_credentials (workspace_id, provider);

CREATE TABLE IF NOT EXISTS ai_models (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL,
	model_key varchar(120) NOT NULL,
	name varchar(160) NOT NULL,
	provider varchar(40) NOT NULL,
	type varchar(16) NOT NULL,
	pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
	enabled boolean NOT NULL DEFAULT true,
	is_default boolean NOT NULL DEFAULT false,
	tier varchar(24) NOT NULL DEFAULT 'custom',
	system boolean NOT NULL DEFAULT false,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_models_workspace_key ON ai_models (workspace_id, model_key);
CREATE INDEX IF NOT EXISTS idx_ai_models_workspace_type_default ON ai_models (workspace_id, type, is_default);

CREATE TABLE IF NOT EXISTS ai_usage_periods (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL,
	period_key varchar(7) NOT NULL,
	request_count int NOT NULL DEFAULT 0,
	image_count int NOT NULL DEFAULT 0,
	estimated_cost numeric(14, 8) NOT NULL DEFAULT 0,
	reserved_requests int NOT NULL DEFAULT 0,
	reserved_images int NOT NULL DEFAULT 0,
	reserved_cost numeric(14, 8) NOT NULL DEFAULT 0,
	last_warning_level int NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_usage_period ON ai_usage_periods (workspace_id, period_key);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL,
	user_id uuid NULL,
	feature varchar(80) NULL,
	provider varchar(40) NOT NULL,
	model_key varchar(120) NOT NULL,
	type varchar(16) NOT NULL,
	prompt_tokens int NOT NULL DEFAULT 0,
	completion_tokens int NOT NULL DEFAULT 0,
	total_tokens int NOT NULL DEFAULT 0,
	image_count int NOT NULL DEFAULT 0,
	estimated_cost numeric(14, 8) NOT NULL DEFAULT 0,
	status varchar(16) NOT NULL DEFAULT 'success',
	error_code varchar(64) NULL,
	error_message varchar(400) NULL,
	duration_ms int NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_created ON ai_usage_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_model ON ai_usage_logs (workspace_id, model_key);
