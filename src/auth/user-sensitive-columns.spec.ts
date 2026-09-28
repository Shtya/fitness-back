import * as path from 'path';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { User } from '../../entities/global.entity';
import { WhatsAppConversation, WhatsAppMessage } from '../whatsapp/entities/whatsapp.entity';

const SENSITIVE = ['password', 'resetPasswordToken', 'resetPasswordExpires'];

describe('User sensitive columns', () => {
	it('are excluded from default selects', () => {
		const columns = getMetadataArgsStorage().columns.filter(
			column => column.target === User && SENSITIVE.includes(column.propertyName),
		);
		expect(columns.map(column => column.propertyName).sort()).toEqual([...SENSITIVE].sort());
		for (const column of columns) expect(column.options.select).toBe(false);
	});

	describe('generated SQL', () => {
		let dataSource: DataSource;

		beforeAll(async () => {
			dataSource = new DataSource({
				type: 'postgres',
				entities: [
					path.join(__dirname, '..', '..', 'entities', '**', '*.entity.ts'),
					path.join(__dirname, '..', '**', '*.entity.ts'),
				],
			});
			await (dataSource as any).buildMetadatas();
		}, 120_000);

		it('does not select password when joining message.senderUser', () => {
			const sql = dataSource
				.createQueryBuilder(WhatsAppMessage, 'message')
				.leftJoinAndSelect('message.senderUser', 'senderUser')
				.getQuery();
			expect(sql).toContain('"senderUser"."name"');
			for (const column of ['password', 'resetPasswordToken', 'resetPasswordExpires']) {
				expect(sql).not.toContain(`"senderUser"."${column}"`);
			}
		});

		it('does not select password when joining conversation.assignedUser', () => {
			const sql = dataSource
				.createQueryBuilder(WhatsAppConversation, 'conversation')
				.leftJoinAndSelect('conversation.assignedUser', 'assignedUser')
				.getQuery();
			expect(sql).not.toContain('"assignedUser"."password"');
		});

		it('still allows explicit opt-in for login', () => {
			const sql = dataSource
				.createQueryBuilder(User, 'user')
				.addSelect('user.password')
				.getQuery();
			expect(sql).toContain('"user"."password"');
		});
	});
});
