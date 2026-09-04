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
		};
		const providers = {
			getProvider: jest.fn(),
		};
		const gateway = {
			emitAccountEvent: jest.fn(),
		};
		const redis = {
			isAvailable: jest.fn().mockResolvedValue(false),
			set: jest.fn().mockResolvedValue(undefined),
			del: jest.fn().mockResolvedValue(undefined),
			get: jest.fn(),
			keys: jest.fn().mockResolvedValue([]),
		};
		const service = new WhatsAppContactPresenceService(
			conversationRepo as any,
			providers as any,
			gateway as any,
			redis as any,
		);
		return { service, gateway, redis, providers, conversationRepo };
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
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(
			'acc-1',
			'online_contacts',
			expect.any(Object),
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

		// Soft-stale safety after many hours without any presence event.
		jest.setSystemTime(now + 7 * 60 * 60_000);
		(service as any).pruneAllAccounts();
		const snap = await service.listOnline('acc-1');
		expect(snap.items).toHaveLength(0);
		expect(gateway.emitAccountEvent).toHaveBeenCalledWith(
			'acc-1',
			'online_contacts',
			expect.any(Object),
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
		expect(memory[0].status).toBe('offline');
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
});
