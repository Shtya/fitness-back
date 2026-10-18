/**
 * Mirrors migrations/20261014_whatsapp_ai_agent.sql. Applied idempotently at boot
 * because production runs with TypeORM synchronize off.
 */
export const AI_AGENT_SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_agent_settings (
		account_id uuid PRIMARY KEY REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		enabled boolean NOT NULL DEFAULT false,
		scope varchar(20) NOT NULL DEFAULT 'selected',
		default_mode varchar(20) NOT NULL DEFAULT 'suggest',
		provider varchar(40) NOT NULL DEFAULT 'ai-free',
		model varchar(80) NOT NULL DEFAULT 'auto',
		agent_name varchar(80),
		business_name varchar(120),
		persona text,
		dialect varchar(30) NOT NULL DEFAULT 'auto',
		tone varchar(20) NOT NULL DEFAULT 'professional',
		reply_length varchar(20) NOT NULL DEFAULT 'short',
		rules text,
		allowed_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
		forbidden_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
		permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
		use_knowledge_base boolean NOT NULL DEFAULT true,
		knowledge_only boolean NOT NULL DEFAULT true,
		use_contact_memory boolean NOT NULL DEFAULT true,
		context_message_limit smallint NOT NULL DEFAULT 12,
		disclose_ai boolean NOT NULL DEFAULT true,
		disclosure_text text,
		handoff_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
		handoff_message text,
		media_policy varchar(20) NOT NULL DEFAULT 'handoff',
		allow_groups boolean NOT NULL DEFAULT false,
		debounce_seconds smallint NOT NULL DEFAULT 8,
		human_pause_minutes smallint NOT NULL DEFAULT 30,
		max_replies_per_hour smallint NOT NULL DEFAULT 12,
		min_confidence real NOT NULL DEFAULT 0.55,
		actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
		updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
		last_error text
	)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_agent_conversations (
		conversation_id uuid PRIMARY KEY REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		mode varchar(20) NOT NULL DEFAULT 'inherit',
		status varchar(20) NOT NULL DEFAULT 'idle',
		status_reason varchar(60),
		paused_until timestamptz,
		last_reply_at timestamptz,
		last_error text,
		pending_suggestion jsonb,
		updated_by uuid REFERENCES users(id) ON DELETE SET NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_agent_conversations_account
		ON whatsapp_ai_agent_conversations(account_id)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_knowledge_entries (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		category varchar(20) NOT NULL DEFAULT 'faq',
		title varchar(200) NOT NULL,
		content text NOT NULL,
		tags jsonb NOT NULL DEFAULT '[]'::jsonb,
		is_active boolean NOT NULL DEFAULT true,
		created_by uuid REFERENCES users(id) ON DELETE SET NULL,
		updated_by uuid REFERENCES users(id) ON DELETE SET NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_knowledge_account
		ON whatsapp_ai_knowledge_entries(account_id, category)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_contact_memory (
		conversation_id uuid PRIMARY KEY REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		facts jsonb NOT NULL DEFAULT '[]'::jsonb,
		commitments jsonb NOT NULL DEFAULT '[]'::jsonb
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_contact_memory_account
		ON whatsapp_ai_contact_memory(account_id)`,
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_agent_runs (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
		trigger_message_id uuid NOT NULL,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		outcome varchar(20) NOT NULL DEFAULT 'running',
		reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
		reply text,
		reply_message_id uuid,
		sources jsonb NOT NULL DEFAULT '[]'::jsonb,
		provider varchar(40),
		model varchar(120),
		latency_ms integer,
		error text,
		CONSTRAINT uq_whatsapp_ai_agent_run_trigger UNIQUE (conversation_id, trigger_message_id)
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_agent_runs_conversation
		ON whatsapp_ai_agent_runs(conversation_id, created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_agent_runs_account
		ON whatsapp_ai_agent_runs(account_id, created_at DESC)`,
	// 20261015_whatsapp_ai_external_models.sql
	`CREATE TABLE IF NOT EXISTS whatsapp_ai_external_models (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		account_id uuid NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		label varchar(80) NOT NULL,
		kind varchar(30) NOT NULL DEFAULT 'openai_compatible',
		preset varchar(30) NOT NULL DEFAULT 'custom',
		base_url varchar(300) NOT NULL,
		model varchar(160) NOT NULL,
		encrypted_api_key text,
		key_last4 varchar(4),
		is_active boolean NOT NULL DEFAULT true,
		last_test_at timestamptz,
		last_test_ok boolean,
		last_test_message varchar(300),
		created_by uuid REFERENCES users(id) ON DELETE SET NULL,
		updated_by uuid REFERENCES users(id) ON DELETE SET NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_external_models_account
		ON whatsapp_ai_external_models(account_id)`,
	`ALTER TABLE whatsapp_ai_agent_settings
		ADD COLUMN IF NOT EXISTS external_model_id uuid REFERENCES whatsapp_ai_external_models(id) ON DELETE SET NULL`,
	// 20261018_whatsapp_ai_agent_run_cost.sql
	`ALTER TABLE whatsapp_ai_agent_runs
		ADD COLUMN IF NOT EXISTS prompt_tokens integer`,
	`ALTER TABLE whatsapp_ai_agent_runs
		ADD COLUMN IF NOT EXISTS completion_tokens integer`,
	`ALTER TABLE whatsapp_ai_agent_runs
		ADD COLUMN IF NOT EXISTS total_tokens integer`,
	`ALTER TABLE whatsapp_ai_agent_runs
		ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6)`,
	`ALTER TABLE whatsapp_ai_agent_runs
		ADD COLUMN IF NOT EXISTS cost_source varchar(20)`,
];
