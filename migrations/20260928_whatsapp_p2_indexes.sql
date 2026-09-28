-- WhatsApp audit 2026-09-27 (P2 indexes).
-- Run outside a transaction block (CONCURRENTLY), e.g. psql without -1.
-- Non-destructive: adds one index. No schema or data changes.
--
-- Contact alias lookups (every @lid / alias resolution) match
--   regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g') = :digits
-- which scanned and filtered every contact of the account. The index expression
-- must stay byte-for-byte identical to the one in whatsapp-sync.service.ts.
-- Assumes standard_conforming_strings = on (the Postgres default), so '\D' is a literal backslash-D.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_contacts_account_phone_digits
  ON whatsapp_contacts (account_id, (regexp_replace(coalesce(phone_number, ''), '\D', '', 'g')));

-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_whatsapp_contacts_account_phone_digits;
