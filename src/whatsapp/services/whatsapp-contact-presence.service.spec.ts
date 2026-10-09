import {
	expandPresenceSubscribeIds,
	WhatsAppContactPresenceService,
} from './whatsapp-contact-presence.service';
import { WhatsAppConversationType } from '../entities/whatsapp.entity';

describe('expandPresenceSubscribeIds', () => {
	it('expands @c.us to @s.whatsapp.net and phone aliases', () => {
		const ids = expandPresenceSubscribeIds('201234567890@c.us', '201234567890');
		expect(ids).toEqual(
			expect.arrayContaining([
				'201234567890@c.us',
				'201234567890@s.whatsapp.net',
			]),
		);
	});

	it('keeps @lid as-is and adds phone aliases from hint', () => {
		const ids = expandPresenceSubscribeIds('123456789012345@lid', '201000000000');
		expect(ids).toEqual(
			expect.arrayContaining([
				'123456789012345@lid',
				'201000000000@c.us',
				'201000000000@s.whatsapp.net',
			]),
		);
	});
});

describe('WhatsAppContactPresenceService', () => {
	function createService() {
		const conversationRepo = {
			createQueryBuilder: jest.fn(),
			find: jest.fn().mockResolvedValue([]),
		};
		const contactRepo = {
			createQueryBuilder: jest.fn(),
		};
		const providers = {
			getProvider: jest.fn(),
		};
		const gateway = {
			emitAccountSnapshotScoped: jest.fn().mockResolvedValue(undefined),
		};
		const redis = {
			isAvailable: jest.fn().mockResolvedValue(false),
			set: jest.fn().mockResolvedValue(undefined),
			del: jest.fn().mockResolvedValue(undefined),
			get: jest.fn(),
			keys: jest.fn().mockResolvedValue([]),
			setWithIndex: jest.fn().mockResolvedValue(undefined),
			delWithIndex: jest.fn().mockResolvedValue(undefined),
			sMembers: jest.fn().mockResolvedValue([]),
			scanKeys: jest.fn().mockResolvedValue([]),
			mGet: jest.fn().mockResolvedValue([]),
		};
		const service = new WhatsAppContactPresenceService(
			conversationRepo as any,
			contactRepo as any,
			providers as any,
			gateway as any,
			redis as any,
		);
		return { service, gateway, redis, providers, conversationRepo, contactRepo };
	}

	function directConversation(overrides: Record<string, any> = {}) {
		return {
			id: 'conv-1',
			accountId: 'acc-1',
			type: WhatsAppConversationType.DIRECT,
			providerChatId: '201111111111@c.us',
			contactId: 'contact-1',
			contact: {
				id: 'contact-1',
				name: 'Ahmed',
				phoneNumber: '201111111111',
				avatarUrl: null,
			},
			...overrides,
		};
	}

	afterEach(() => {
		jest.useRealTimers();
	});

	it('marks contact online from available presence and scopes by account', async () => {
		const { service, gateway } = createService();
		const conversation = directConversation();
		service.applyPresenceEvent('acc-1', conversation as any, {
			state: 'available',
			isOnline: true,
			t: Date.now(),
		});
		service.applyPresenceEvent('acc-2', directConversation({ id: 'conv-2' }) as any, {
			state: 'available',
			isOnline: true,
			t: Date.now(),
		});

		const snap1 = await service.listOnline('acc-1');
		const snap2 = await service.listOnline('acc-2');
		expect(snap1.items).toHaveLength(1);
		expect(snap1.items[0].conversationId).toBe('conv-1');
		expect(snap1.items[0].online).toBe(true);
		expect(snap1.items[0].name).toContain('Ahmed');
		expect(snap2.items[0].conversationId).toBe('conv-2');
		expect(gateway.emitAccountSnapshotScoped).toHaveBeenCalledWith(
			'acc-1',
			'online_contacts',
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('marks contact offline on unavailable and keeps lastSeen', async () => {
		const { service } = createService();
		const conversation = directConversation();
		service.applyPresenceEvent('acc-1', conversation as any, {
			state: 'available',
			isOnline: true,
			lastSeen: 1_700_000_000_000,
			t: Date.now(),
		});
		service.applyPresenceEvent('acc-1', conversation as any, {
			state: 'unavailable',
			isOnline: false,
			t: Date.now(),
		});
		const onlineOnly = await service.listOnline('acc-1');
		expect(onlineOnly.items).toHaveLength(0);
		const withOffline = await service.listOnline('acc-1', { includeOffline: true });
		expect(withOffline.items).toHaveLength(1);
		expect(withOffline.items[0].online).toBe(false);
		expect(withOffline.items[0].lastSeen).toBe(1_700_000_000_000);
	});

	it('stamps lastSeen from prior online observation when WA omits it', async () => {
		const { service } = createService();
		const conversation = directConversation();
		const onlineAt = Date.now() - 5_000;
		service.applyPresenceEvent('acc-1', conversation as any, {
			state: 'available',
			isOnline: true,
			t: onlineAt,
		});
		service.applyPresenceEvent('acc-1', conversation as any, {
			state: 'unavailable',
			isOnline: false,
			t: onlineAt + 2_000,
		});
		const withOffline = await service.listOnline('acc-1', { includeOffline: true });
		expect(withOffline.items).toHaveLength(1);
		expect(withOffline.items[0].online).toBe(false);
		expect(withOffline.items[0].lastSeen).toBe(onlineAt);
	});

	it('treats composing as typing/online', async () => {
		const { service } = createService();
		service.applyPresenceEvent('acc-1', directConversation() as any, {
			state: 'composing',
			t: Date.now(),
		});
		const snap = await service.listOnline('acc-1');
		expect(snap.items[0].typing).toBe(true);
		expect(snap.items[0].online).toBe(true);
		expect(snap.items[0].status).toBe('typing');
	});

	it('keeps online until unavailable (WhatsApp does not re-ping available)', async () => {
		jest.useFakeTimers();
		const { service, gateway } = createService();
		const now = Date.now();
		jest.setSystemTime(now);
		service.applyPresenceEvent('acc-1', directConversation() as any, {
			state: 'available',
			isOnline: true,
			t: now,
		});
		expect((await service.listOnline('acc-1')).items).toHaveLength(1);

		// Still online after several minutes without another presence packet.
		jest.setSystemTime(now + 5 * 60_000);
		(service as any).pruneAllAccounts();
		expect((await service.listOnline('acc-1')).items).toHaveLength(1);
		expect((await service.listOnline('acc-1')).items[0].online).toBe(true);

		// Soft-stale safety after many hours without any presence event → unknown, not offline.
		jest.setSystemTime(now + 7 * 60 * 60_000);
		(service as any).pruneAllAccounts();
		const snap = await service.listOnline('acc-1');
		expect(snap.items).toHaveLength(0);
		const stale = service.getMemorySnapshot('acc-1')[0];
		expect(stale?.online).toBe(false);
		expect(stale?.status).toBe('unknown');
		expect(gateway.emitAccountSnapshotScoped).toHaveBeenCalledWith(
			'acc-1',
			'online_contacts',
			expect.any(Object),
			expect.any(Function),
		);
	});

	it('clears typing after short TTL without clearing online', async () => {
		jest.useFakeTimers();
		const { service } = createService();
		const now = Date.now();
		jest.setSystemTime(now);
		service.applyPresenceEvent('acc-1', directConversation() as any, {
			state: 'composing',
			t: now,
		});
		expect((await service.listOnline('acc-1')).items[0].typing).toBe(true);
		jest.setSystemTime(now + 30_000);
		(service as any).pruneAllAccounts();
		const snap = await service.listOnline('acc-1');
		expect(snap.items).toHaveLength(1);
		expect(snap.items[0].typing).toBe(false);
		expect(snap.items[0].online).toBe(true);
	});

	it('seedConversationRoster never marks contacts online', async () => {
		const { service } = createService();
		service.seedConversationRoster('acc-1', [directConversation() as any]);
		const online = await service.listOnline('acc-1');
		expect(online.items).toHaveLength(0);
		const memory = service.getMemorySnapshot('acc-1');
		expect(memory[0].online).toBe(false);
		expect(memory[0].status).toBe('unknown');
	});

	it('ignores group chats for presence', async () => {
		const { service } = createService();
		service.applyPresenceEvent(
			'acc-1',
			directConversation({
				type: WhatsAppConversationType.GROUP,
				providerChatId: '120363@g.us',
			}) as any,
			{ state: 'available', isOnline: true, t: Date.now() },
		);
		expect(service.getMemorySnapshot('acc-1')).toHaveLength(0);
	});

	it('clearAccount removes only that session presence', async () => {
		const { service } = createService();
		service.applyPresenceEvent('acc-1', directConversation() as any, {
			state: 'available',
			isOnline: true,
			t: Date.now(),
		});
		service.applyPresenceEvent(
			'acc-2',
			directConversation({ id: 'conv-2' }) as any,
			{ state: 'available', isOnline: true, t: Date.now() },
		);
		service.clearAccount('acc-1');
		expect((await service.listOnline('acc-1')).items).toHaveLength(0);
		expect((await service.listOnline('acc-2')).items).toHaveLength(1);
	});

	describe('Redis persistence', () => {
		function storedEntry(conversationId: string, overrides: Record<string, any> = {}) {
			return {
				accountId: 'acc-1',
				conversationId,
				contactId: null,
				chatId: `${conversationId}@c.us`,
				name: conversationId,
				phoneNumber: null,
				avatarUrl: null,
				status: 'online',
				online: true,
				typing: false,
				recording: false,
				state: 'available',
				lastSeen: 0,
				updatedAt: Date.now(),
				...overrides,
			};
		}

		it('writes value + index in one call with the account index key', async () => {
			const { service, redis } = createService();
			service.applyPresenceEvent('acc-1', directConversation() as any, {
				state: 'available',
				isOnline: true,
				t: Date.now(),
			});
			await Promise.resolve();
			expect(redis.setWithIndex).toHaveBeenCalledWith(
				'wa:presence:acc-1:conv-1',
				expect.objectContaining({ conversationId: 'conv-1', online: true }),
				6 * 60 * 60,
				'wa:presence:index:acc-1',
				'conv-1',
				6 * 60 * 60,
			);
			expect(redis.set).not.toHaveBeenCalled();
		});

		it('hydrates once via SMEMBERS + MGET (no per-key GET, no KEYS)', async () => {
			const { service, redis } = createService();
			redis.isAvailable.mockResolvedValue(true);
			redis.sMembers.mockResolvedValue(['conv-a', 'conv-b']);
			redis.mGet.mockResolvedValue([storedEntry('conv-a'), storedEntry('conv-b')]);

			const first = await service.listOnline('acc-1');
			await service.listOnline('acc-1');
			await service.listOnline('acc-1', { includeOffline: true });

			expect(first.items.map((i) => i.conversationId).sort()).toEqual(['conv-a', 'conv-b']);
			expect(redis.mGet).toHaveBeenCalledWith([
				'wa:presence:acc-1:conv-a',
				'wa:presence:acc-1:conv-b',
			]);
			expect(redis.sMembers).toHaveBeenCalledTimes(1);
			expect(redis.mGet).toHaveBeenCalledTimes(1);
			expect(redis.isAvailable).toHaveBeenCalledTimes(1);
			expect(redis.get).not.toHaveBeenCalled();
			expect(redis.keys).not.toHaveBeenCalled();
		});

		it('falls back to SCAN (never KEYS) when the index is empty', async () => {
			const { service, redis } = createService();
			redis.isAvailable.mockResolvedValue(true);
			redis.scanKeys.mockResolvedValue([
				'wa:presence:acc-1:conv-a',
				'wa:presence:index:acc-1',
			]);
			redis.mGet.mockResolvedValue([storedEntry('conv-a')]);

			const snap = await service.listOnline('acc-1');

			expect(redis.scanKeys).toHaveBeenCalledWith('wa:presence:acc-1:*');
			expect(redis.mGet).toHaveBeenCalledWith(['wa:presence:acc-1:conv-a']);
			expect(redis.keys).not.toHaveBeenCalled();
			expect(snap.items).toHaveLength(1);
		});

		it('ignores hydrated rows from another account and keeps newer memory state', async () => {
			const { service, redis } = createService();
			redis.isAvailable.mockResolvedValue(true);
			redis.sMembers.mockResolvedValue(['conv-1', 'conv-x']);
			redis.mGet.mockResolvedValue([
				storedEntry('conv-1', { online: true, updatedAt: 1 }),
				storedEntry('conv-x', { accountId: 'acc-2' }),
			]);
			service.applyPresenceEvent('acc-1', directConversation() as any, {
				state: 'unavailable',
				t: Date.now(),
			});

			const snap = await service.listOnline('acc-1', { includeOffline: true });

			expect(snap.items.map((i) => i.conversationId)).toEqual(['conv-1']);
			expect(snap.items[0].online).toBe(false);
		});

		it('retries hydration later if Redis was unavailable', async () => {
			const { service, redis } = createService();
			await service.listOnline('acc-1');
			redis.isAvailable.mockResolvedValue(true);
			redis.sMembers.mockResolvedValue(['conv-a']);
			redis.mGet.mockResolvedValue([storedEntry('conv-a')]);

			const snap = await service.listOnline('acc-1');

			expect(snap.items).toHaveLength(1);
			expect(redis.sMembers).toHaveBeenCalledTimes(1);
		});

		it('coalesces a burst of presence events into one online_contacts emit', async () => {
			const { service, gateway } = createService();
			for (let i = 0; i < 20; i += 1) {
				service.applyPresenceEvent(
					'acc-1',
					directConversation({ id: `conv-${i}`, providerChatId: `2011111111${i}@c.us` }) as any,
					{ state: 'available', isOnline: true, t: Date.now() },
				);
			}
			await new Promise((resolve) => setImmediate(resolve));

			const emits = gateway.emitAccountSnapshotScoped.mock.calls.filter(
				([, event]) => event === 'online_contacts',
			);
			expect(emits).toHaveLength(1);
			expect(emits[0][2].items).toHaveLength(20);
		});

		it('restricts a snapshot to chats assigned to the member (audit P4 scoping)', async () => {
			const { service, conversationRepo } = createService();
			conversationRepo.find.mockResolvedValue([
				{ id: 'conv-mine', assignedUserId: 'user-1' },
				{ id: 'conv-other', assignedUserId: 'user-2' },
				{ id: 'conv-free', assignedUserId: null },
			]);
			const snapshot = {
				accountId: 'acc-1',
				at: 'now',
				items: [
					{ conversationId: 'conv-mine' },
					{ conversationId: 'conv-other' },
					{ conversationId: 'conv-free' },
				] as any[],
			};

			const scoped = await service.restrictToAssignee(snapshot, 'user-1');

			expect(scoped.items.map((item) => item.conversationId)).toEqual(['conv-mine']);
			expect(conversationRepo.find).toHaveBeenCalledTimes(1);
			expect((await service.restrictToAssignee(snapshot, '')).items).toHaveLength(0);
		});

		it('skips the assignee query for an empty snapshot', async () => {
			const { service, conversationRepo } = createService();
			const assignees = await service.assigneesFor([]);
			expect(assignees.size).toBe(0);
			expect(conversationRepo.find).not.toHaveBeenCalled();
		});

		it('clearAccount deletes the persisted account rows and index', async () => {
			const { service, redis } = createService();
			redis.sMembers.mockResolvedValue(['conv-1']);
			service.applyPresenceEvent('acc-1', directConversation() as any, {
				state: 'available',
				isOnline: true,
				t: Date.now(),
			});
			service.clearAccount('acc-1');
			await new Promise((resolve) => setImmediate(resolve));

			expect(redis.delWithIndex).toHaveBeenCalledWith(
				['wa:presence:acc-1:conv-1', 'wa:presence:index:acc-1'],
				'wa:presence:index:acc-1',
				[],
			);
		});
	});
});
