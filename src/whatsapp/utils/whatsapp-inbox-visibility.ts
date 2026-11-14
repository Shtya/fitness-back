import { SelectQueryBuilder } from 'typeorm';
import { WhatsAppContact, WhatsAppMessage } from '../entities/whatsapp.entity';

/**
 * Chat-list search. Besides the chat's contact name and number, it finds:
 * - the name you saved someone under (phonebook_name / local_name), which `name` does not hold;
 * - a number typed any way (+20 100…, 0100…): digits are compared on their own;
 * - a chat kept under an @lid id, whose contact has no real number: the number and saved name
 *   sit on the same person's phone-id contact, joined by the phone the @lid contact resolved to.
 * Expects `contact` and `group` joined on `conversation`. One line per condition, for the reason
 * given on onlyConversationsWithMessages.
 */
export function matchConversationSearch<T>(query: SelectQueryBuilder<T>, rawSearch: string, alias = 'conversation') {
	const search = String(rawSearch || '').trim();
	if (!search) return query;
	const digits = search.replace(/\D/g, '');
	const withDigits = digits.length >= 4;
	return query.andWhere(
		(qb) => {
			const samePerson = qb
				.subQuery()
				.select('1')
				.from(WhatsAppContact, 'otherContact')
				.where(`otherContact.accountId = ${alias}.accountId`)
				.andWhere(
					`(otherContact.waId = ${alias}.providerChatId OR (contact.phoneNumber IS NOT NULL AND otherContact.phoneNumber = contact.phoneNumber))`,
				)
				.andWhere(
					`(otherContact.name ILIKE :search OR otherContact.phonebookName ILIKE :search OR otherContact.localName ILIKE :search${
						withDigits ? ' OR otherContact.phoneNumber LIKE :searchDigits' : ''
					})`,
				)
				.getQuery();
			const parts = [
				'contact.name ILIKE :search',
				'contact.phonebookName ILIKE :search',
				'contact.localName ILIKE :search',
				'contact.phoneNumber ILIKE :search',
				...(withDigits ? ['contact.phoneNumber LIKE :searchDigits', `${alias}.providerChatId LIKE :searchDigits`] : []),
				'group.subject ILIKE :search',
				`${alias}.providerChatId ILIKE :search`,
				`EXISTS ${samePerson}`,
			];
			return `(${parts.join(' OR ')})`;
		},
		{ search: `%${search}%`, searchDigits: `%${digits}%` },
	);
}

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
