/**
 * Unread for the staff member a chat is assigned to, kept apart from the account's own
 * unread (`whatsapp_conversations.unread_count`). The owner opening a chat must not clear
 * the assignee's badge, and the assignee opening it must not clear the owner's.
 */
export const ASSIGNEE_UNREAD_TABLE = 'whatsapp_assignee_unread';

type Run = (sql: string, params?: unknown[]) => Promise<any>;

/** SQL for the assignee's unread of `<alias>.id`; bind the user id as `:<param>`. */
export function assigneeUnreadSql(alias = 'conversation', param = 'assigneeUnreadUserId') {
	return `COALESCE((SELECT au.unread_count FROM ${ASSIGNEE_UNREAD_TABLE} au WHERE au.conversation_id = ${alias}.id AND au.user_id = :${param}), 0)`;
}

function firstCount(result: any): number {
	const rows = Array.isArray(result?.[0]) ? result[0] : result;
	return Math.max(0, Number(rows?.[0]?.unread_count) || 0);
}

export async function bumpAssigneeUnread(run: Run, conversationId: string, userId: string) {
	const result = await run(
		`INSERT INTO ${ASSIGNEE_UNREAD_TABLE} (conversation_id, user_id, unread_count, updated_at)
		 VALUES ($1, $2, 1, now())
		 ON CONFLICT (conversation_id, user_id)
		 DO UPDATE SET unread_count = ${ASSIGNEE_UNREAD_TABLE}.unread_count + 1, updated_at = now()
		 RETURNING unread_count`,
		[conversationId, userId],
	);
	return firstCount(result);
}

export async function setAssigneeUnread(
	run: Run,
	conversationId: string,
	userId: string,
	count: number,
) {
	const value = Math.max(0, Math.floor(Number(count) || 0));
	await run(
		`INSERT INTO ${ASSIGNEE_UNREAD_TABLE} (conversation_id, user_id, unread_count, updated_at)
		 VALUES ($1, $2, $3, now())
		 ON CONFLICT (conversation_id, user_id)
		 DO UPDATE SET unread_count = EXCLUDED.unread_count, updated_at = now()`,
		[conversationId, userId, value],
	);
	return value;
}

export async function getAssigneeUnread(run: Run, conversationId: string, userId: string) {
	const result = await run(
		`SELECT unread_count FROM ${ASSIGNEE_UNREAD_TABLE} WHERE conversation_id = $1 AND user_id = $2`,
		[conversationId, userId],
	);
	return firstCount(result);
}

export async function assigneeUnreadByConversation(
	run: Run,
	userId: string,
	conversationIds: string[],
) {
	const map = new Map<string, number>();
	if (!userId || !conversationIds.length) return map;
	const rows = await run(
		`SELECT conversation_id, unread_count FROM ${ASSIGNEE_UNREAD_TABLE}
		 WHERE user_id = $1 AND conversation_id = ANY($2::uuid[])`,
		[userId, conversationIds],
	);
	for (const row of rows || []) {
		map.set(String(row.conversation_id), Math.max(0, Number(row.unread_count) || 0));
	}
	return map;
}
