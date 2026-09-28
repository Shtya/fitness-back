-- WhatsApp audit 2026-09-27 (P1 indexes).
-- Run each statement outside a transaction block (CONCURRENTLY), e.g. psql without -1.
-- Non-destructive: adds one index, drops one duplicate index. No data changes.
--
-- 1) Alias / contact lookups and contact deletes (FK ON DELETE SET NULL) filter
--    whatsapp_conversations by contact_id, which had no index (seq scan per lookup).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_conversations_contact_id
  ON whatsapp_conversations (contact_id);

-- 2) whatsapp_message_reactions(message_id) was indexed twice (entity IDX_0f99… + this one);
--    uq_whatsapp_message_reaction_actor (message_id, actor_key) also covers message_id lookups.
DROP INDEX CONCURRENTLY IF EXISTS idx_whatsapp_message_reactions_message_id;

-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_whatsapp_conversations_contact_id;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_message_reactions_message_id
--     ON whatsapp_message_reactions (message_id);
