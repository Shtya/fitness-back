import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppAccessService } from '../services/whatsapp-access.service';
import { WhatsAppGateway, accountAllRoom, accountAssigneeRoom } from './whatsapp.gateway';

const ACCOUNT = 'account-1';
const CONVERSATION = 'conv-1';

type FakeSocket = { id: string; data: Record<string, any>; received: any[] };

/**
 * Room-level socket.io double: one emit to several rooms reaches each member once
 * (like socket.io's `to([...])`), and `except` removes members of other rooms.
 */
function fakeServer() {
	const rooms = new Map<string, Set<FakeSocket>>();
	const members = (names: string[], excluded: string[] = []) => {
		const out = new Set<FakeSocket>();
		for (const name of names) for (const socket of rooms.get(name) ?? []) out.add(socket);
		for (const name of excluded) for (const socket of rooms.get(name) ?? []) out.delete(socket);
		return [...out];
	};
	const operator = (names: string[], excluded: string[] = []): any => ({
		emit: (_event: string, packet: any) => {
			for (const socket of members(names, excluded)) socket.received.push(packet);
		},
		except: (room: string | string[]) => operator(names, [...excluded, ...([] as string[]).concat(room)]),
		fetchSockets: async () => members(names, excluded),
	});
	const server = {
		to: jest.fn((room: string | string[]) => operator(([] as string[]).concat(room))),
		in: jest.fn((room: string | string[]) => operator(([] as string[]).concat(room))),
	};
	const client = (id: string, userId: string) => {
		const socket: FakeSocket & { join: jest.Mock; leave: jest.Mock } = {
			id,
			data: {},
			received: [],
			join: jest.fn(async (room: string | string[]) => {
				for (const name of ([] as string[]).concat(room)) {
					if (!rooms.has(name)) rooms.set(name, new Set());
					rooms.get(name)!.add(socket);
				}
			}),
			leave: jest.fn(async (room: string) => {
				rooms.get(room)?.delete(socket);
			}),
		};
		socket.data.user = { id: userId };
		return socket;
	};
	return { server, rooms, client };
}

describe('WhatsAppGateway scoped fan-out', () => {
	let gateway: WhatsAppGateway;
	let accessService: { getAccountAccess: jest.Mock; canSeeAllConversations: jest.Mock };
	let fake: ReturnType<typeof fakeServer>;

	beforeEach(async () => {
		accessService = {
			getAccountAccess: jest.fn().mockResolvedValue({ canView: true }),
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
		fake = fakeServer();
		gateway.server = fake.server as any;
	});

	/** Joins through the real watch handler so the room mapping under test is the production one. */
	async function watcher(id: string, userId: string, canSeeAll: boolean) {
		const socket = fake.client(id, userId);
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValueOnce({ id: userId });
		accessService.canSeeAllConversations.mockReturnValueOnce(canSeeAll);
		await gateway.watchAccount(socket as any, ACCOUNT);
		return socket;
	}

	it('records the scope before joining the inbox room and its scope sub-room', async () => {
		const order: string[] = [];
		const client: any = { data: {}, join: jest.fn(async () => order.push('join')) };
		accessService.canSeeAllConversations.mockImplementation(() => {
			order.push('scope');
			return true;
		});
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'user-1' });

		const result = await gateway.watchAccount(client, ACCOUNT);

		expect(result).toEqual({ ok: true });
		expect(client.data.accountScopes[ACCOUNT]).toEqual({ canSeeAll: true, room: accountAllRoom(ACCOUNT) });
		expect(client.join).toHaveBeenCalledWith([`whatsapp:account:${ACCOUNT}`, accountAllRoom(ACCOUNT)]);
		expect(order).toEqual(['scope', 'join']);
	});

	it('maps restricted members to their own assignee room', async () => {
		const coach = await watcher('s-coach', 'coach', false);
		expect(coach.data.accountScopes[ACCOUNT].room).toBe(accountAssigneeRoom(ACCOUNT, 'coach'));
	});

	it('rejects an inbox watch without canView', async () => {
		accessService.getAccountAccess.mockResolvedValue({ canView: false });
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'user-1' });
		const client: any = { data: {}, join: jest.fn() };

		await expect(gateway.watchAccount(client, ACCOUNT)).rejects.toThrow(/canView/);
		expect(client.join).not.toHaveBeenCalled();
	});

	it('broadcasts to both rooms when no scope is given', async () => {
		const coach = await watcher('s-coach', 'coach', false);
		gateway.emitConversationEvent(CONVERSATION, 'sync_progress', { done: 1 }, ACCOUNT);

		expect(fake.server.to).toHaveBeenCalledWith([
			`whatsapp:conversation:${CONVERSATION}`,
			`whatsapp:account:${ACCOUNT}`,
		]);
		expect(coach.received).toHaveLength(1);
	});

	it('delivers a scoped message only to the assignee and to canSeeAll members, without fetchSockets', async () => {
		const manager = await watcher('s-manager', 'manager', true);
		const assignee = await watcher('s-assignee', 'assignee', false);
		const other = await watcher('s-other', 'other-coach', false);

		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'private' }, ACCOUNT, {
			assignedUserId: 'assignee',
		});

		expect(manager.received).toHaveLength(1);
		expect(assignee.received).toHaveLength(1);
		// A canView-only coach must not receive another staff member's chat.
		expect(other.received).toHaveLength(0);
		expect(fake.server.in).not.toHaveBeenCalled();
	});

	it('delivers once to a member who also watches the open chat', async () => {
		const manager = await watcher('s-manager', 'manager', true);
		await (manager as any).join(`whatsapp:conversation:${CONVERSATION}`);

		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'hi' }, ACCOUNT, {
			assignedUserId: null,
		});

		expect(manager.received).toHaveLength(1);
	});

	it('serves the open-chat room even for an unassigned restricted viewer', async () => {
		const viewer = fake.client('s-viewer', 'viewer');
		await (viewer as any).join(`whatsapp:conversation:${CONVERSATION}`);

		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'hi' }, ACCOUNT, {
			assignedUserId: 'someone-else',
		});

		expect(viewer.received).toHaveLength(1);
	});

	it('delivers shared conversations to everyone watching the inbox', async () => {
		const other = await watcher('s-other', 'other-coach', false);

		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'memo' }, ACCOUNT, {
			assignedUserId: null,
			shared: true,
		});

		expect(other.received).toHaveLength(1);
	});

	it('never delivers scoped events to a socket that joined the inbox room without a scope', async () => {
		const stray = fake.client('s-stray', 'ghost');
		await (stray as any).join(`whatsapp:account:${ACCOUNT}`);

		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'private' }, ACCOUNT, {
			assignedUserId: 'assignee',
		});

		expect(stray.received).toHaveLength(0);
	});

	it('scopes conversation_updated previews on the account channel', async () => {
		const other = await watcher('s-other', 'other-coach', false);
		const assignee = await watcher('s-assignee', 'assignee', false);

		gateway.emitAccountEvent(ACCOUNT, 'conversation_updated', { preview: { text: 'private' } }, {
			assignedUserId: 'assignee',
		});

		expect(other.received).toHaveLength(0);
		expect(assignee.received).toHaveLength(1);
	});

	it('moves a socket to the new scope room when its permission changes on re-watch', async () => {
		const socket = fake.client('s-coach', 'coach');
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'coach' });
		accessService.canSeeAllConversations.mockReturnValueOnce(true).mockReturnValueOnce(false);
		await gateway.watchAccount(socket as any, ACCOUNT);
		await gateway.watchAccount(socket as any, ACCOUNT);

		expect(socket.leave).toHaveBeenCalledWith(accountAllRoom(ACCOUNT));
		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'x' }, ACCOUNT, {
			assignedUserId: 'someone-else',
		});
		expect(socket.received).toHaveLength(0);
	});

	it('leaves the inbox room and the scope room on unwatch', async () => {
		const manager = await watcher('s-manager', 'manager', true);

		await gateway.unwatchAccount(manager as any, ACCOUNT);

		expect(manager.data.accountScopes[ACCOUNT]).toBeUndefined();
		expect(manager.leave).toHaveBeenCalledWith(`whatsapp:account:${ACCOUNT}`);
		expect(manager.leave).toHaveBeenCalledWith(accountAllRoom(ACCOUNT));
		gateway.emitConversationEvent(CONVERSATION, 'message', { text: 'x' }, ACCOUNT, {
			assignedUserId: null,
		});
		expect(manager.received).toHaveLength(0);
	});

	describe('online contacts snapshot (audit P4)', () => {
		const snapshot = {
			accountId: ACCOUNT,
			at: 'now',
			items: [{ conversationId: 'conv-mine' }, { conversationId: 'conv-other' }],
		};

		it('sends the full snapshot to canSeeAll members and only assigned items to others', async () => {
			const manager = await watcher('s-manager', 'manager', true);
			const coach = await watcher('s-coach', 'coach', false);
			const stray = fake.client('s-stray', 'ghost');
			await (stray as any).join(`whatsapp:account:${ACCOUNT}`);
			(stray as any).emit = (_e: string, p: any) => stray.received.push(p);
			(coach as any).emit = (_e: string, p: any) => coach.received.push(p);
			const resolveAssignees = jest.fn().mockResolvedValue(
				new Map([
					['conv-mine', 'coach'],
					['conv-other', 'someone-else'],
				]),
			);

			await gateway.emitAccountSnapshotScoped(ACCOUNT, 'online_contacts', snapshot, resolveAssignees);

			expect(manager.received[0].payload.items).toHaveLength(2);
			expect(coach.received[0].payload.items).toEqual([{ conversationId: 'conv-mine' }]);
			expect(stray.received).toHaveLength(0);
			expect(resolveAssignees).toHaveBeenCalledTimes(1);
		});

		it('skips the assignee lookup when every member can see all chats', async () => {
			await watcher('s-manager', 'manager', true);
			const resolveAssignees = jest.fn();

			await gateway.emitAccountSnapshotScoped(ACCOUNT, 'online_contacts', snapshot, resolveAssignees);

			expect(resolveAssignees).not.toHaveBeenCalled();
		});
	});
});

describe('WhatsAppGateway staff presence (audit P4)', () => {
	let gateway: WhatsAppGateway;

	beforeEach(async () => {
		const moduleRef = await Test.createTestingModule({
			providers: [
				WhatsAppGateway,
				{ provide: WhatsAppAccessService, useValue: { getAccountAccess: jest.fn() } },
				{ provide: JwtService, useValue: { verify: jest.fn() } },
				{ provide: getRepositoryToken(User), useValue: { findOne: jest.fn() } },
			],
		}).compile();
		gateway = moduleRef.get(WhatsAppGateway);
		gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
	});

	function client(id: string) {
		return { id, data: {} as Record<string, any>, join: jest.fn() };
	}

	it('lets only admins join the staff presence room, while everyone is still tracked', () => {
		const admin = client('s-admin');
		const coach = client('s-coach');

		(gateway as any).registerPresence(admin, { id: 'admin-1', name: 'Admin', role: 'admin' });
		(gateway as any).registerPresence(coach, { id: 'coach-1', name: 'Coach', role: 'coach' });

		expect(admin.join).toHaveBeenCalledWith('whatsapp:presence');
		expect(coach.join).not.toHaveBeenCalled();
		expect(gateway.getOnlinePresence().items.map((item) => item.userId).sort()).toEqual([
			'admin-1',
			'coach-1',
		]);
	});

	it('returns an empty list to non-admin callers', async () => {
		const coach = client('s-coach');
		jest.spyOn(gateway as any, 'resolveUser').mockResolvedValue({ id: 'coach-1', role: 'coach' });
		(gateway as any).registerPresence(coach, { id: 'coach-1', name: 'Coach', role: 'coach' });

		const result = await gateway.presenceList(coach as any);

		expect(result.items).toEqual([]);
		expect((result as any).forbidden).toBe(true);
	});
});

describe('WhatsAppGateway JWT expiry (A8)', () => {
	let gateway: WhatsAppGateway;
	let jwt: { verify: jest.Mock };
	let users: { findOne: jest.Mock };

	beforeEach(async () => {
		jwt = { verify: jest.fn() };
		users = { findOne: jest.fn().mockResolvedValue({ id: 'user-1', name: 'Staff' }) };
		const moduleRef = await Test.createTestingModule({
			providers: [
				WhatsAppGateway,
				{ provide: WhatsAppAccessService, useValue: { getAccountAccess: jest.fn() } },
				{ provide: JwtService, useValue: jwt },
				{ provide: getRepositoryToken(User), useValue: users },
			],
		}).compile();
		gateway = moduleRef.get(WhatsAppGateway);
		gateway.server = { to: jest.fn(() => ({ emit: jest.fn() })) } as any;
	});

	afterEach(() => jest.useRealTimers());

	function socketClient() {
		return {
			id: 'socket-1',
			data: {} as Record<string, any>,
			handshake: { auth: { token: 'jwt' }, headers: {} },
			join: jest.fn(),
			emit: jest.fn(),
			disconnect: jest.fn(),
		};
	}

	it('disconnects the socket when its token expires and clears the timer on disconnect', async () => {
		jest.useFakeTimers({ now: 1_000_000 });
		jwt.verify.mockReturnValue({ id: 'user-1', exp: (1_000_000 + 60_000) / 1000 });
		const client = socketClient();

		await gateway.handleConnection(client as any);
		expect(client.disconnect).not.toHaveBeenCalled();

		jest.advanceTimersByTime(60_000);
		expect(client.emit).toHaveBeenCalledWith('whatsapp:auth_expired');
		expect(client.disconnect).toHaveBeenCalledWith(true);

		gateway.handleDisconnect(client as any);
		expect((gateway as any).tokenExpiryTimers.size).toBe(0);
	});

	it('rejects later events from a socket whose token has expired', async () => {
		jest.useFakeTimers({ now: 1_000_000 });
		jwt.verify.mockReturnValue({ id: 'user-1', exp: (1_000_000 + 1_000) / 1000 });
		const client = socketClient();
		await gateway.handleConnection(client as any);
		gateway.handleDisconnect(client as any);
		jest.setSystemTime(1_000_000 + 2_000);

		const result = await gateway.watchAccount(client as any, ACCOUNT);

		expect(result).toEqual({ ok: false, error: 'Unauthorized' });
		expect(client.disconnect).toHaveBeenCalled();
		expect(jwt.verify).toHaveBeenCalledTimes(1);
	});
});
