import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppGateway } from './whatsapp.gateway';

const ACCOUNT = 'account-1';
const CONVERSATION = 'conv-1';

/** Minimal socket.io double: records what each socket received. */
function fakeSocket(id: string, data: Record<string, any>) {
	return { id, data, received: [] as any[], emit(_e: string, p: any) { this.received.push(p); } };
}

describe('WhatsAppGateway scoped fan-out', () => {
	let gateway: WhatsAppGateway;
	let accessService: { getAccountAccess: jest.Mock; canSeeAllConversations: jest.Mock };
	let conversationRoomEmit: jest.Mock;
	let accountSockets: ReturnType<typeof fakeSocket>[];

	beforeEach(async () => {
		accessService = {
			getAccountAccess: jest.fn(),
			canSeeAllConversations: jest.fn(),
		};
		const moduleRef = await Test.createTestingModule({
			providers: [
				WhatsAppGateway,
				{ provide: WhatsAppAccessService, useValue: accessService },
				{ provide: JwtService, useValue: { verify: jest.fn() } },
				{ provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
			],
		}).compile();
		gateway = moduleRef.get(WhatsAppGateway);

		conversationRoomEmit = jest.fn();
		accountSockets = [];
		const except = jest.fn(() => ({ fetchSockets: async () => accountSockets }));
		gateway.server = {
			to: jest.fn(() => ({ emit: conversationRoomEmit, except })),
			in: jest.fn(() => ({ except, fetchSockets: async () => accountSockets })),
		} as any;
	});

	const flush = () => new Promise(resolve => setImmediate(resolve));

	it('records canSeeAll on the socket before joining the inbox room', async () => {
		const order: string[] = [];
		const client: any = {
			data: {},
			join: jest.fn(async () => order.push('join')),
		};
		accessService.getAccountAccess.mockResolvedValue({ canView: true });
		accessService.canSeeAllConversations.mockImplementation(() => {
			order.push('scope');
			return true;
		});
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'user-1' });

		const result = await gateway.watchAccount(client, ACCOUNT);

		expect(result).toEqual({ ok: true });
		expect(client.data.accountScopes[ACCOUNT]).toEqual({ canSeeAll: true });
		expect(order).toEqual(['scope', 'join']);
	});

	it('rejects an inbox watch without canView', async () => {
		accessService.getAccountAccess.mockResolvedValue({ canView: false });
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'user-1' });
		const client: any = { data: {}, join: jest.fn() };

		await expect(gateway.watchAccount(client, ACCOUNT)).rejects.toThrow(/canView/);
		expect(client.join).not.toHaveBeenCalled();
	});

	it('broadcasts to both rooms when no scope is given', () => {
		gateway.emitConversationEvent(CONVERSATION, 'sync_progress', { done: 1 }, ACCOUNT);

		expect(gateway.server.to).toHaveBeenCalledWith([
			`whatsapp:conversation:${CONVERSATION}`,
			`whatsapp:account:${ACCOUNT}`,
		]);
		expect(conversationRoomEmit).toHaveBeenCalledTimes(1);
	});

	it('delivers a scoped message only to the assignee and to canSeeAll members', async () => {
		const manager = fakeSocket('s-manager', {
			user: { id: 'manager' },
			accountScopes: { [ACCOUNT]: { canSeeAll: true } },
		});
		const assignee = fakeSocket('s-assignee', {
			user: { id: 'assignee' },
			accountScopes: { [ACCOUNT]: { canSeeAll: false } },
		});
		const other = fakeSocket('s-other', {
			user: { id: 'other-coach' },
			accountScopes: { [ACCOUNT]: { canSeeAll: false } },
		});
		accountSockets = [manager, assignee, other];

		gateway.emitConversationEvent(
			CONVERSATION,
			'message',
			{ text: 'private' },
			ACCOUNT,
			{ assignedUserId: 'assignee' },
		);
		await flush();

		expect(manager.received).toHaveLength(1);
		expect(assignee.received).toHaveLength(1);
		// The leak this fix closes: a canView-only coach used to get the payload.
		expect(other.received).toHaveLength(0);
		// The open-chat room is still served directly, exactly once.
		expect(conversationRoomEmit).toHaveBeenCalledTimes(1);
	});

	it('delivers shared conversations to everyone watching the inbox', async () => {
		const other = fakeSocket('s-other', {
			user: { id: 'other-coach' },
			accountScopes: { [ACCOUNT]: { canSeeAll: false } },
		});
		accountSockets = [other];

		gateway.emitConversationEvent(
			CONVERSATION,
			'message',
			{ text: 'memo' },
			ACCOUNT,
			{ assignedUserId: null, shared: true },
		);
		await flush();

		expect(other.received).toHaveLength(1);
	});

	it('drops the event when a socket has no recorded scope', async () => {
		const stray = fakeSocket('s-stray', { user: { id: 'ghost' } });
		accountSockets = [stray];

		gateway.emitConversationEvent(
			CONVERSATION,
			'message',
			{ text: 'private' },
			ACCOUNT,
			{ assignedUserId: 'assignee' },
		);
		await flush();

		expect(stray.received).toHaveLength(0);
	});

	it('scopes conversation_updated previews on the account channel', async () => {
		const other = fakeSocket('s-other', {
			user: { id: 'other-coach' },
			accountScopes: { [ACCOUNT]: { canSeeAll: false } },
		});
		accountSockets = [other];

		gateway.emitAccountEvent(
			ACCOUNT,
			'conversation_updated',
			{ preview: { text: 'private' } },
			{ assignedUserId: 'assignee' },
		);
		await flush();

		expect(other.received).toHaveLength(0);
	});

	it('leaves the account scope behind on unwatch', async () => {
		const client: any = {
			data: { accountScopes: { [ACCOUNT]: { canSeeAll: true } } },
			leave: jest.fn(),
		};

		await gateway.unwatchAccount(client, ACCOUNT);

		expect(client.data.accountScopes[ACCOUNT]).toBeUndefined();
		expect(client.leave).toHaveBeenCalledWith(`whatsapp:account:${ACCOUNT}`);
	});
});
