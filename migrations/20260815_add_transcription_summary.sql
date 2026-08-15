-- CRM-style request summary for WhatsApp / transcript bundles
ALTER TABLE transcriptions
	ADD COLUMN IF NOT EXISTS "summaryPayload" jsonb NULL;
