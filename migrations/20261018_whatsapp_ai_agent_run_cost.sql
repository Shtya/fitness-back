-- Per-request token usage + estimated USD cost for WhatsApp AI agent runs.
ALTER TABLE whatsapp_ai_agent_runs
	ADD COLUMN IF NOT EXISTS prompt_tokens integer,
	ADD COLUMN IF NOT EXISTS completion_tokens integer,
	ADD COLUMN IF NOT EXISTS total_tokens integer,
	ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12, 6),
	ADD COLUMN IF NOT EXISTS cost_source varchar(20);
