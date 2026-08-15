-- Isolate Meta WhatsApp config, inbox, bulk jobs, and replies per tenant / owner.

ALTER TABLE meta_whatsapp_config
	ADD COLUMN IF NOT EXISTS owner_user_id uuid NULL,
	ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_meta_wa_config_owner ON meta_whatsapp_config (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_meta_wa_config_tenant ON meta_whatsapp_config (tenant_id);

-- Existing singleton belongs to the first admin (keeps current WABA on that gym only).
UPDATE meta_whatsapp_config c
SET
	owner_user_id = COALESCE(c.owner_user_id, u.id),
	tenant_id = COALESCE(c.tenant_id, u."tenantId")
FROM (
	SELECT id, "tenantId"
	FROM users
	WHERE LOWER(email) = 'admin@gmail.com'
	LIMIT 1
) u
WHERE c.owner_user_id IS NULL;

UPDATE meta_whatsapp_config c
SET
	owner_user_id = COALESCE(
		c.owner_user_id,
		(SELECT id FROM users WHERE role::text IN ('admin', 'super_admin') ORDER BY id ASC LIMIT 1)
	)
WHERE c.owner_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_wa_config_owner
	ON meta_whatsapp_config (owner_user_id)
	WHERE owner_user_id IS NOT NULL;

ALTER TABLE meta_whatsapp_conversations
	ADD COLUMN IF NOT EXISTS config_id uuid NULL;

UPDATE meta_whatsapp_conversations
SET config_id = (SELECT id FROM meta_whatsapp_config ORDER BY created_at ASC LIMIT 1)
WHERE config_id IS NULL;

ALTER TABLE meta_whatsapp_conversations
	DROP CONSTRAINT IF EXISTS uq_meta_wa_conversations_wa_id;
DROP INDEX IF EXISTS uq_meta_wa_conversations_wa_id;

CREATE INDEX IF NOT EXISTS idx_meta_wa_conversations_config ON meta_whatsapp_conversations (config_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_wa_conversations_config_wa
	ON meta_whatsapp_conversations (config_id, wa_id)
	WHERE config_id IS NOT NULL;

ALTER TABLE meta_whatsapp_bulk_jobs
	ADD COLUMN IF NOT EXISTS config_id uuid NULL;
UPDATE meta_whatsapp_bulk_jobs
SET config_id = (SELECT id FROM meta_whatsapp_config ORDER BY created_at ASC LIMIT 1)
WHERE config_id IS NULL;

ALTER TABLE meta_whatsapp_activity_logs
	ADD COLUMN IF NOT EXISTS config_id uuid NULL;
UPDATE meta_whatsapp_activity_logs
SET config_id = (SELECT id FROM meta_whatsapp_config ORDER BY created_at ASC LIMIT 1)
WHERE config_id IS NULL;

ALTER TABLE meta_whatsapp_quick_replies
	ADD COLUMN IF NOT EXISTS config_id uuid NULL;
UPDATE meta_whatsapp_quick_replies
SET config_id = (SELECT id FROM meta_whatsapp_config ORDER BY created_at ASC LIMIT 1)
WHERE config_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_meta_wa_quick_replies_config ON meta_whatsapp_quick_replies (config_id);
