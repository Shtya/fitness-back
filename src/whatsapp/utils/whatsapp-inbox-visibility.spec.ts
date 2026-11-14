import * as path from 'path';
import { DataSource } from 'typeorm';
import { WhatsAppConversation } from '../entities/whatsapp.entity';
import { matchConversationSearch, onlyConversationsWithMessages } from './whatsapp-inbox-visibility';

/**
 * Builds the real SQL from the entity metadata (no database needed). The first version wrote the
 * condition over several lines; TypeORM left `conversation.lastMessageAt` untranslated and
 * Postgres answered "column conversation.lastmessageat does not exist" for every chat list.
 */
describe('chat list: only chats with messages', () => {
	let dataSource: DataSource;

	beforeAll(async () => {
		dataSource = new DataSource({
			type: 'postgres',
			entities: [
				path.join(__dirname, '..', '..', '..', 'entities', '**', '*.entity.ts'),
				path.join(__dirname, '..', '..', '**', '*.entity.ts'),
			],
		});
		await (dataSource as any).buildMetadatas();
	}, 120_000);

	const sqlFor = (pinnedSql: string | null) => {
		const query = dataSource
			.getRepository(WhatsAppConversation)
			.createQueryBuilder('conversation')
			.where('conversation.accountId = :accountId', { accountId: 'a' });
		onlyConversationsWithMessages(query, pinnedSql);
		return { sql: query.getQuery(), params: query.getParameters() };
	};

	it('uses the real column names, never the raw property names', () => {
		const { sql } = sqlFor(null);
		expect(sql).toContain('"conversation"."last_message_at" IS NOT NULL');
		expect(sql).toContain('LOWER("conversation"."provider_chat_id") LIKE :inboxGroupChat');
		expect(sql).toMatch(/"anyMessage"\."conversation_id" = "conversation"\."id"/);
		expect(sql).not.toMatch(/conversation\.lastMessageAt|conversation\.providerChatId|anyMessage\.conversationId/);
	});

	it('keeps groups, channels, the AI memo chat and pinned chats', () => {
		const { sql, params } = sqlFor('COALESCE("p"."is_pinned", false)');
		expect(params).toMatchObject({
			inboxGroupChat: '%@g.us',
			inboxChannelChat: '%@newsletter',
			inboxMemoChat: 'email-memo-ai@so7ba.internal',
		});
		expect(sql).toContain('COALESCE("p"."is_pinned", false) = true');
		expect(sql).toContain('EXISTS (SELECT 1 FROM "whatsapp_messages" "anyMessage"');
	});
});

describe('chat list search', () => {
	let dataSource: DataSource;

	beforeAll(async () => {
		dataSource = new DataSource({
			type: 'postgres',
			entities: [
				path.join(__dirname, '..', '..', '..', 'entities', '**', '*.entity.ts'),
				path.join(__dirname, '..', '..', '**', '*.entity.ts'),
			],
		});
		await (dataSource as any).buildMetadatas();
	}, 120_000);

	const build = (search: string) => {
		const query = dataSource
			.getRepository(WhatsAppConversation)
			.createQueryBuilder('conversation')
			.leftJoin('conversation.contact', 'contact')
			.leftJoin('conversation.group', 'group')
			.where('conversation.accountId = :accountId', { accountId: 'a' });
		matchConversationSearch(query, search);
		return { sql: query.getQuery(), params: query.getParameters() };
	};

	it('searches the saved (phonebook) name and the same person under their phone id, with real column names', () => {
		const { sql, params } = build('Marehan');
		expect(sql).toContain('"contact"."phonebook_name" ILIKE :search');
		expect(sql).toContain('"contact"."local_name" ILIKE :search');
		expect(sql).toMatch(/FROM "whatsapp_contacts" "otherContact"/);
		expect(sql).toContain('"otherContact"."phonebook_name" ILIKE :search');
		expect(sql).toContain('"otherContact"."phone_number" = "contact"."phone_number"');
		expect(sql).not.toMatch(/contact\.phonebookName|otherContact\.waId|conversation\.providerChatId/);
		expect(params).toMatchObject({ search: '%Marehan%' });
	});

	it('matches a number however it is typed', () => {
		const { sql, params } = build('+20 100 943 7066');
		expect(params).toMatchObject({ searchDigits: '%201009437066%' });
		expect(sql).toContain('"contact"."phone_number" LIKE :searchDigits');
		expect(sql).toContain('"otherContact"."phone_number" LIKE :searchDigits');
	});
});
