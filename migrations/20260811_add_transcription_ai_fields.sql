-- AI enhance / memorize fields for transcriptions
ALTER TABLE transcriptions
	ADD COLUMN IF NOT EXISTS "originalText" text NULL,
	ADD COLUMN IF NOT EXISTS "enhancedText" text NULL,
	ADD COLUMN IF NOT EXISTS "enhancementMeta" jsonb NULL,
	ADD COLUMN IF NOT EXISTS "memorizePayload" jsonb NULL;
