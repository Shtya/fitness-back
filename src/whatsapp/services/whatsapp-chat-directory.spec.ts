import { ForbiddenException } from '@nestjs/common';
import { WhatsAppSyncService } from './whatsapp-sync.service';

function service(rows: any[], access: { canView: boolean; canSeeAll: boolean }) {
	const s = Object.create(WhatsAppSyncService.prototype) as any;
	s.access = {
		getAccountAccess: jest.fn(async () => ({ canView: access.canView })),
		canSeeAllConversations: jest.fn(() => access.canSeeAll),
	};
	s.conversationRepo = { query: jest.fn(async () => rows) };
	return s;
}

const USER = { id: 'staff-1' } as any;
const row = (extra: Record<string, unknown> = {}) => ({
	id: 'c1',
	provider_chat_id: '201028311164@c.us',
	type: 'individual',
	last_message_at: new Date('2026-10-12T10:00:00Z'),
	deleted_at: null,
	contact_name: 'Mohamed',
	local_name: 'م محمد البهنسي',
	phonebook_name: null,
	phone_number: '201028311164',
	contact_avatar: null,
	subject: null,
	group_avatar: null,
	...extra,
});

describe('chat directory (on-device search)', () => {
	it('returns every chat compactly, with the saved name first', async () => {
		const s = service([row()], { canView: true, canSeeAll: true });
		const result = await s.conversationDirectory(USER, 'acc-1');
		expect(result.full).toBe(true);
		expect(result.items[0]).toEqual(
			expect.objectContaining({ id: 'c1', providerChatId: '201028311164@c.us', contact: expect.objectContaining({ name: 'م محمد البهنسي', phoneNumber: '201028311164' }) }),
		);
		const [sql] = s.conversationRepo.query.mock.calls[0];
		expect(sql).toContain('c.deleted_at IS NULL');
		expect(sql).not.toContain('assigned_user_id');
	});

	it('staff limited to their chats only get those', async () => {
		const s = service([], { canView: true, canSeeAll: false });
		await s.conversationDirectory(USER, 'acc-1');
		const [sql, params] = s.conversationRepo.query.mock.calls[0];
		expect(sql).toContain('c.assigned_user_id = $2');
		expect(params).toEqual(['acc-1', 'staff-1']);
	});

	it('a delta returns what changed, deleted chats as removals', async () => {
		const since = new Date(Date.now() - 60_000).toISOString();
		const s = service([row({ id: 'gone', deleted_at: new Date() }), row({ id: 'c2' })], { canView: true, canSeeAll: true });
		const result = await s.conversationDirectory(USER, 'acc-1', since);
		expect(result.full).toBe(false);
		expect(result.items).toEqual([{ id: 'gone', deleted: true }, expect.objectContaining({ id: 'c2' })]);
		const [sql] = s.conversationRepo.query.mock.calls[0];
		expect(sql).toContain('c.deleted_at > $2');
	});

	it('refuses users without access to the account', async () => {
		const s = service([], { canView: false, canSeeAll: false });
		await expect(s.conversationDirectory(USER, 'acc-1')).rejects.toBeInstanceOf(ForbiddenException);
	});
});
