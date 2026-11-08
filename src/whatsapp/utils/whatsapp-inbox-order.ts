/**
 * Inbox order is `lastMessageAt`, and it may only move forward. After a relink the phone's fresh
 * chat store reports stale chat times; writing those back made old chats jump to the top while
 * chats with today's messages sank out of the first page (their messages were still there).
 */
export function shouldAdvanceLastMessageAt(
	previous: Date | string | null | undefined,
	next: Date | string | null | undefined,
): boolean {
	const nextMs = next ? new Date(next).getTime() : NaN;
	if (!Number.isFinite(nextMs) || nextMs <= 0) return false;
	const previousMs = previous ? new Date(previous).getTime() : 0;
	return !Number.isFinite(previousMs) || nextMs > previousMs;
}

/**
 * Raises each chat's `lastMessageAt` to its newest stored message, for one account. Repairs
 * chats that an earlier sync moved backwards. Never lowers a value.
 */
export const REPAIR_INBOX_ORDER_SQL = `
UPDATE whatsapp_conversations AS conversation
SET last_message_at = newest.max_at
FROM (
	SELECT conversation_id, MAX(provider_timestamp) AS max_at
	FROM whatsapp_messages
	WHERE account_id = $1 AND deleted_at IS NULL AND provider_timestamp IS NOT NULL
	GROUP BY conversation_id
) AS newest
WHERE conversation.id = newest.conversation_id
	AND conversation.account_id = $1
	AND conversation.deleted_at IS NULL
	AND (conversation.last_message_at IS NULL OR conversation.last_message_at < newest.max_at)
RETURNING conversation.id`;
