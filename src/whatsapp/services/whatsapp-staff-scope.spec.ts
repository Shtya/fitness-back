import { WhatsAppSyncService } from './whatsapp-sync.service';
import { WhatsAppTypingAttemptsService } from './whatsapp-typing-attempts.service';
import { buildStaffSessions } from '../utils/whatsapp-staff-activity';
import { assigneeUnreadSql } from '../utils/whatsapp-assignee-unread';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const coach = { id: 'aaaaaaaa-0000-4000-8000-000000000001' } as any;
const owner = { id: 'aaaaaaaa-0000-4000-8000-000000000002' } as any;

function conversationQuery(rows: any[]) {
	const qb: any = {
		where: jest.fn(() => qb),
		andWhere: jest.fn(() => qb),
		getMany: jest.fn(async () => rows),
		getOne: jest.fn(async () => rows[0] || null),
	};
	return qb;
}

describe('groups for staff limited to their assigned chats', () => {
	const groups = [
		{ id: 'g1', subject: 'Assigned group', participants: [] },
		{ id: 'g2', subject: 'Someone else group', participants: [] },
	];

	function fakeSync(canSeeAll: boolean, assignedRows: any[]) {
		const self: any = Object.create(WhatsAppSyncService.prototype);
		Object.assign(self, {
			access: {
				getAccountAccess: jest.fn(async () => ({ canView: true })),
				canSeeAllConversations: jest.fn(() => canSeeAll),
			},
			groupRepo: {
				find: jest.fn(async () => groups),
				findOne: jest.fn(async ({ where }: any) => groups.find(g => g.id === where.id) || null),
			},
			conversationRepo: { createQueryBuilder: jest.fn(() => conversationQuery(assignedRows)) },
		});
		return self;
	}

	it('lists only the groups whose chat is assigned to them', async () => {
		const self = fakeSync(false, [{ id: 'conv-1', groupId: 'g1' }]);
		const result = await WhatsAppSyncService.prototype.listGroups.call(self, coach, ACCOUNT);
		expect(result.map((g: any) => g.id)).toEqual(['g1']);
	});

	it('still lists every group for the owner', async () => {
		const self = fakeSync(true, [{ id: 'conv-1', groupId: 'g1' }]);
		const result = await WhatsAppSyncService.prototype.listGroups.call(self, owner, ACCOUNT);
		expect(result.map((g: any) => g.id)).toEqual(['g1', 'g2']);
	});

	it('refuses the details of a group that is not theirs', async () => {
		const self = fakeSync(false, []);
		await expect(
			WhatsAppSyncService.prototype.getGroupDetails.call(self, coach, ACCOUNT, 'g2'),
		).rejects.toThrow('WhatsApp group not found');
	});
});

describe('separate unread for the owner and the assignee', () => {
	const conversation = {
		id: 'bbbbbbbb-0000-4000-8000-000000000001',
		accountId: ACCOUNT,
		assignedUserId: coach.id,
		providerChatId: '201000000001@s.whatsapp.net',
		unreadCount: 4,
	};

	function fakeSync(canSeeAll: boolean) {
		const update = jest.fn(async () => undefined);
		const query = jest.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
		const emitAccountEvent = jest.fn();
		const self: any = Object.create(WhatsAppSyncService.prototype);
		Object.assign(self, {
			assertConversationVisible: jest.fn(async () => ({
				conversation,
				accountAccess: { canUse: false, account: { settings: {} } },
			})),
			access: { canSeeAllConversations: jest.fn(() => canSeeAll) },
			conversationRepo: { update, manager: { query } },
			runSql: (sql: string, params?: unknown[]) => query(sql, params),
			gateway: { emitAccountEvent },
			audit: { write: jest.fn(async () => undefined) },
			conversationEventScope: () => ({ assignedUserId: coach.id, shared: false }),
		});
		return { self, update, query, emitAccountEvent };
	}

	it('the coach opening the chat clears only the coach count', async () => {
		const { self, update, query, emitAccountEvent } = fakeSync(false);
		await WhatsAppSyncService.prototype.markConversationRead.call(self, coach, conversation.id);
		expect(update).not.toHaveBeenCalled();
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('whatsapp_assignee_unread'),
			[conversation.id, coach.id, 0],
		);
		expect(emitAccountEvent.mock.calls[0][2]).toMatchObject({ userId: coach.id, scope: 'assignee' });
	});

	it('the owner opening the chat leaves the coach count alone', async () => {
		const { self, update, query, emitAccountEvent } = fakeSync(true);
		await WhatsAppSyncService.prototype.markConversationRead.call(self, owner, conversation.id);
		expect(update).toHaveBeenCalledWith(conversation.id, { unreadCount: 0 });
		expect(query).not.toHaveBeenCalled();
		expect(emitAccountEvent.mock.calls[0][2]).toMatchObject({ userId: owner.id, scope: 'account' });
	});

	it('the assignee unread SQL reads the per-user table', () => {
		expect(assigneeUnreadSql('conversation', 'u')).toContain('whatsapp_assignee_unread');
		expect(assigneeUnreadSql('conversation', 'u')).toContain(':u');
	});
});

describe('typing log for assigned-only staff', () => {
	it('is refused', async () => {
		const service: any = Object.create(WhatsAppTypingAttemptsService.prototype);
		service.access = {
			getAccountAccess: jest.fn(async () => ({ canView: true })),
			canSeeAllConversations: jest.fn(() => false),
			assertWholeAccountAccess: jest.fn(async () => {
				throw new Error('Only people who see the whole WhatsApp account can open this');
			}),
		};
		await expect(
			service.scope(coach, { accountId: ACCOUNT }, () => undefined),
		).rejects.toThrow('whole WhatsApp account');
	});
});

describe('staff sessions in the report', () => {
	const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 12, h, m)).toISOString();

	it('splits activity on a 30 minute gap and counts chats and messages per session', () => {
		const sessions = buildStaffSessions([
			{ at: at(9, 0), kind: 'present' },
			{ at: at(9, 2), kind: 'opened', conversationId: 'c1' },
			{ at: at(9, 3), kind: 'replied', conversationId: 'c1' },
			{ at: at(9, 4), kind: 'replied', conversationId: 'c1' },
			{ at: at(9, 10), kind: 'opened', conversationId: 'c2' },
			{ at: at(14, 0), kind: 'present' },
			{ at: at(14, 5), kind: 'opened', conversationId: 'c3' },
		]);
		expect(sessions).toHaveLength(2);
		// newest first
		expect(sessions[0]).toMatchObject({ startedAt: at(14, 0), endedAt: at(14, 5), chatsOpened: 1, messagesSent: 0 });
		expect(sessions[1]).toMatchObject({
			startedAt: at(9, 0),
			endedAt: at(9, 10),
			durationSeconds: 600,
			chatsOpened: 2,
			messagesSent: 2,
			chatsRepliedTo: 1,
		});
	});

	it('is empty without activity', () => {
		expect(buildStaffSessions([])).toEqual([]);
	});
});
