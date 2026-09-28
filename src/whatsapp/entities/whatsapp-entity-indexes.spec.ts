import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { WhatsAppContact, WhatsAppConversation, WhatsAppMessageReaction } from './whatsapp.entity';

describe('WhatsApp entity indexes (audit P1)', () => {
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

	it('declares the contact_id index with the migration name (no duplicate on synchronize)', () => {
		const indices = dataSource.getMetadata(WhatsAppConversation).indices;
		const contact = indices.filter((index) =>
			index.columns.some((column) => column.databaseName === 'contact_id'),
		);
		expect(contact.map((index) => index.name)).toEqual(['idx_whatsapp_conversations_contact_id']);
	});

	it('keeps exactly one single-column message_id index on reactions', () => {
		const indices = dataSource
			.getMetadata(WhatsAppMessageReaction)
			.indices.filter(
				(index) =>
					index.columns.length === 1 && index.columns[0].databaseName === 'message_id',
			);
		expect(indices).toHaveLength(1);
		expect(indices[0].name).not.toBe('idx_whatsapp_message_reactions_message_id');
	});

	it('migration creates the same index name and drops the duplicate concurrently', () => {
		const sql = fs.readFileSync(
			path.join(__dirname, '..', '..', '..', 'migrations', '20260928_whatsapp_p1_indexes.sql'),
			'utf8',
		);
		const statements = sql
			.split('\n')
			.filter((line) => !line.trim().startsWith('--'))
			.join('\n');
		expect(statements).toMatch(
			/CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_conversations_contact_id\s+ON whatsapp_conversations \(contact_id\);/,
		);
		expect(statements).toMatch(
			/DROP INDEX CONCURRENTLY IF EXISTS idx_whatsapp_message_reactions_message_id;/,
		);
		expect(statements).not.toMatch(/\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i);
	});

	describe('contact phone-digits expression index (audit P2)', () => {
		const migration = fs.readFileSync(
			path.join(__dirname, '..', '..', '..', 'migrations', '20260928_whatsapp_p2_indexes.sql'),
			'utf8',
		);
		const statements = migration
			.split('\n')
			.filter((line) => !line.trim().startsWith('--'))
			.join('\n');

		it('is registered on the entity but left to the migration', () => {
			const index = dataSource
				.getMetadata(WhatsAppContact)
				.indices.find((item) => item.name === 'idx_whatsapp_contacts_account_phone_digits');
			expect(index).toBeDefined();
			expect(index?.synchronize).toBe(false);
		});

		it('is created concurrently and non-destructively', () => {
			expect(statements).toMatch(
				/CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_whatsapp_contacts_account_phone_digits/,
			);
			expect(statements).not.toMatch(/\b(DROP|TRUNCATE|DELETE FROM|ALTER TABLE)\b/i);
		});

		it('uses exactly the expression the alias lookups query, so the planner can match it', () => {
			const indexExpression = statements.match(/\(account_id, \((regexp_replace\(.+?\))\)\);/)?.[1];
			expect(indexExpression).toBe(`regexp_replace(coalesce(phone_number, ''), '\\D', '', 'g')`);
			const service = fs.readFileSync(
				path.join(__dirname, '..', 'services', 'whatsapp-sync.service.ts'),
				'utf8',
			);
			const queried = [...service.matchAll(/regexp_replace\(coalesce\(c\.phone_number[^`]*?'g'\)/g)].map(
				(match) => match[0].replace('c.phone_number', 'phone_number').replace(/\\\\/g, '\\'),
			);
			expect(queried.length).toBeGreaterThan(0);
			for (const expression of queried) expect(expression).toBe(indexExpression);
		});
	});
});
