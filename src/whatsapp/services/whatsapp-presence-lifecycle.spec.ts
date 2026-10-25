import { WhatsAppContactPresenceService } from './whatsapp-contact-presence.service';
import { WhatsAppConversationType } from '../entities/whatsapp.entity';

/**
 * Presence lifecycle as WhatsApp actually behaves for a linked device (Baileys 7):
 * - real presence only for contacts whose privacy token (tctoken) we hold,
 * - a subscribe is answered with the current state,
 * - the same person may be addressed by phone JID or by LID.
 */
function qb(rows: any[] = []) {
	const chain: any = {};
	for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take']) chain[m] = () => chain;
	chain.getMany = async () => rows;
	return chain;
}

function setup({ deviceAvailable = true, tokenJids = [] as string[] } = {}) {
	let providerListener: ((accountId: string, event: any) => void) | null = null;
	const provider = {
		getState: () => 'connected',
		isOnlinePresence: () => deviceAvailable,
		subscribePresence: jest.fn(async (ids: string[]) => ids.length),
		presenceTokenJids: jest.fn(async () => tokenJids),
	};
	const providers = {
		getProvider: jest.fn(() => provider),
		onProviderEvent: (fn: any) => {
			providerListener = fn;
			return () => undefined;
		},
	};
	const redis = {
		isAvailable: jest.fn().mockResolvedValue(false),
		setWithIndex: jest.fn().mockResolvedValue(undefined),
		delWithIndex: jest.fn().mockResolvedValue(undefined),
		sMembers: jest.fn().mockResolvedValue([]),
		scanKeys: jest.fn().mockResolvedValue([]),
		mGet: jest.fn().mockResolvedValue([]),
		exists: jest.fn().mockResolvedValue(false),
	};
	const gateway = { emitAccountSnapshotScoped: jest.fn().mockResolvedValue(undefined), accountWatcherCount: () => 1 };
	const service = new WhatsAppContactPresenceService(
		{ createQueryBuilder: () => qb([]), find: jest.fn().mockResolvedValue([]) } as any,
		{ createQueryBuilder: () => qb([]) } as any,
		providers as any,
		gateway as any,
		redis as any,
	);
	service.onModuleInit();
	return { service, provider, redis, emitProvider: (event: any) => providerListener?.('acc-1', event) };
}

const conv = (id: string, chatId: string, phone: string | null = '201111111111', contactId = 'contact-1') => ({
	id,
	accountId: 'acc-1',
	type: WhatsAppConversationType.DIRECT,
	providerChatId: chatId,
	contactId,
	contact: { id: contactId, name: 'Mona', phoneNumber: phone, avatarUrl: null },
});

const live = async (service: WhatsAppContactPresenceService) =>
	(await service.listOnline('acc-1')).items.map((i) => i.conversationId);

afterEach(() => jest.useRealTimers());

describe('presence lifecycle', () => {
	it('online without any message: token holders are subscribed first, and their "available" shows', async () => {
		const { service, provider } = setup({ tokenJids: ['201111111111@s.whatsapp.net'] });
		await service.subscribeRecentDirectChats('acc-1', 200, true);
		expect(provider.subscribePresence.mock.calls[0][0][0]).toBe('201111111111@s.whatsapp.net');
		expect(service.diagnostics('acc-1').contactsWithPrivacyToken).toBe(1);

		service.applyPresenceEvent('acc-1', conv('c1', '201111111111@c.us') as any, { state: 'available' });
		expect(await live(service)).toEqual(['c1']);
		service.onModuleDestroy();
	});

	it('a new privacy token (someone messaged us) triggers a subscribe for them right away', async () => {
		jest.useFakeTimers();
		const { service, provider, emitProvider } = setup();
		emitProvider({ type: 'presence_token', jids: ['5555@lid'] });
		await jest.advanceTimersByTimeAsync(1_600);
		expect(provider.subscribePresence).toHaveBeenCalledWith(['5555@lid']);
		service.onModuleDestroy();
	});

	it('message while online keeps them online (typing → available)', async () => {
		const { service } = setup();
		const c = conv('c1', '201111111111@c.us') as any;
		service.applyPresenceEvent('acc-1', c, { state: 'available' });
		service.applyPresenceEvent('acc-1', c, { state: 'composing' });
		service.applyPresenceEvent('acc-1', c, { state: 'available' });
		const [row] = (await service.listOnline('acc-1')).items;
		expect(row).toMatchObject({ conversationId: 'c1', online: true, typing: false });
		service.onModuleDestroy();
	});

	it('closing WhatsApp: "offline" sent under the LID still clears the row that went online under the phone id', async () => {
		const { service } = setup();
		const c = conv('c1', '201111111111@c.us') as any;
		// online arrived as LID with a known phone → sync remembers both forms
		service.rememberAliases('acc-1', 'c1', ['201111111111@c.us', '7777@lid']);
		service.applyPresenceEvent('acc-1', c, { state: 'available' });
		expect(await live(service)).toEqual(['c1']);
		// offline arrives as the bare LID, no phone mapping known
		expect(service.lookupAlias('acc-1', ['7777@lid'], null)).toBe('c1');
		service.applyPresenceEvent('acc-1', c, { state: 'unavailable' });
		expect(await live(service)).toEqual([]);
		service.onModuleDestroy();
	});

	it('closing WhatsApp clears a twin row of the same person (phone chat + LID chat)', async () => {
		const { service } = setup();
		service.applyPresenceEvent('acc-1', conv('pn', '201111111111@c.us') as any, { state: 'available' });
		service.applyPresenceEvent('acc-1', conv('lid', '7777@lid') as any, { state: 'unavailable' });
		expect(await live(service)).toEqual([]);
		service.onModuleDestroy();
	});

	it('coming back after going offline shows online again and alerts followers', async () => {
		const { service } = setup();
		const seen: string[] = [];
		service.onCameOnline((e) => seen.push(e.conversationId));
		const c = conv('c1', '201111111111@c.us') as any;
		service.applyPresenceEvent('acc-1', c, { state: 'available' });
		service.applyPresenceEvent('acc-1', c, { state: 'unavailable' });
		service.applyPresenceEvent('acc-1', c, { state: 'available' });
		expect(await live(service)).toEqual(['c1']);
		expect(seen).toEqual(['c1', 'c1']);
		service.onModuleDestroy();
	});

	it('after a server restart, a stored "online" is not shown live until WhatsApp confirms it', async () => {
		const { service, redis } = setup();
		redis.isAvailable.mockResolvedValue(true);
		redis.sMembers.mockResolvedValue(['c1']);
		redis.mGet.mockResolvedValue([
			{ accountId: 'acc-1', conversationId: 'c1', chatId: '201111111111@c.us', name: 'Mona', status: 'online', online: true, typing: false, recording: false, state: 'available', lastSeen: 0, updatedAt: Date.now() - 60_000, contactId: null, phoneNumber: '201111111111', avatarUrl: null },
		]);
		expect(await live(service)).toEqual([]);
		const row = (await service.listOnline('acc-1', { includeOffline: true })).items[0];
		expect(row).toMatchObject({ online: false, status: 'unknown' });
		// WhatsApp answers the post-restart subscribe
		service.applyPresenceEvent('acc-1', conv('c1', '201111111111@c.us') as any, { state: 'available' });
		expect(await live(service)).toEqual(['c1']);
		service.onModuleDestroy();
	});

	it('stale live status is re-checked: answered → stays online; unanswered → unknown (not offline)', async () => {
		const start = Date.now();
		const now = jest.spyOn(Date, 'now');
		now.mockReturnValue(start);
		const { service, provider } = setup();
		service.applyPresenceEvent('acc-1', conv('a', '201111111111@c.us', '201111111111', 'ca') as any, { state: 'available' });
		service.applyPresenceEvent('acc-1', conv('b', '202222222222@c.us', '202222222222', 'cb') as any, { state: 'available' });

		now.mockReturnValue(start + 90_000);
		await (service as any).verifyLiveContacts();
		expect(provider.subscribePresence).toHaveBeenCalled();

		now.mockReturnValue(start + 100_000);
		service.applyPresenceEvent('acc-1', conv('a', '201111111111@c.us', '201111111111', 'ca') as any, { state: 'available' });

		now.mockReturnValue(start + 140_000);
		await (service as any).verifyLiveContacts();
		const items = (await service.listOnline('acc-1', { includeOffline: true })).items;
		expect(items.find((i) => i.conversationId === 'a')).toMatchObject({ online: true });
		expect(items.find((i) => i.conversationId === 'b')).toMatchObject({ online: false, status: 'unknown' });
		now.mockRestore();
		service.onModuleDestroy();
	});

	it('does not "verify" while the device is unavailable (answers would all be unavailable)', async () => {
		const start = Date.now();
		const now = jest.spyOn(Date, 'now').mockReturnValue(start);
		const { service, provider } = setup({ deviceAvailable: false });
		service.applyPresenceEvent('acc-1', conv('a', '201111111111@c.us') as any, { state: 'available' });
		now.mockReturnValue(start + 200_000);
		await (service as any).verifyLiveContacts();
		expect(provider.subscribePresence).not.toHaveBeenCalled();
		now.mockRestore();
		service.onModuleDestroy();
	});
});
