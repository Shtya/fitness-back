import { SelectQueryBuilder } from 'typeorm';
import { WhatsAppMessage } from '../entities/whatsapp.entity';

/** The internal AI chat that carries email summaries; always listed. */
export const EMAIL_MEMO_AI_CHAT_ID = 'email-memo-ai@so7ba.internal';

/**
 * Like WhatsApp, someone you never exchanged a message with is not a chat. Linking brings the
 * phone's contacts and chat list, which left rows without a single message in the inbox. A row
 * is listed once it has a message; groups, channels, the AI Memo chat and pinned chats always are.
 *
 * `pinnedSql` is the SQL for "this chat is pinned" (preference join of the caller), or null.
 * The condition is one line on purpose: TypeORM maps `conversation.lastMessageAt` to its column
 * (last_message_at) only after a space, "(" or "="; after a newline it reached Postgres as-is
 * and failed with "column conversation.lastmessageat does not exist".
 */
export function onlyConversationsWithMessages<T>(
	query: SelectQueryBuilder<T>,
	pinnedSql: string | null,
	alias = 'conversation',
) {
	return query.andWhere(
		(qb) => {
			const anyMessage = qb
				.subQuery()
				.select('1')
				.from(WhatsAppMessage, 'anyMessage')
				.where(`anyMessage.conversationId = ${alias}.id`)
				.getQuery();
			const parts = [
				`${alias}.lastMessageAt IS NOT NULL`,
				`EXISTS ${anyMessage}`,
				`LOWER(${alias}.providerChatId) LIKE :inboxGroupChat`,
				`LOWER(${alias}.providerChatId) LIKE :inboxChannelChat`,
				`${alias}.providerChatId = :inboxMemoChat`,
				...(pinnedSql ? [`${pinnedSql} = true`] : []),
			];
			return `(${parts.join(' OR ')})`;
		},
		{
			inboxGroupChat: '%@g.us',
			inboxChannelChat: '%@newsletter',
			inboxMemoChat: EMAIL_MEMO_AI_CHAT_ID,
		},
	);
}
