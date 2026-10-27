import { WhatsAppContactPresenceService } from './whatsapp-contact-presence.service';
import { WhatsAppOnlinePresenceService } from './whatsapp-online-presence.service';
import { WhatsAppConversationType } from '../entities/whatsapp.entity';

/**
 * Subscription hygiene and device availability — the reasons presence "worked for a while,
 * then stopped" on the live server (flooding) and showed fake "offline" (unavailable device).
 */
function qb(rows: any[]) {
	const chain: any = {};
	for (const m of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take']) chain[m] = () => chain;
	chain.getMany = async () => rows;
	return chain;
}

const chatRow = (id: string, jid: string) => ({
	id,
	accountId: 'acc-1',
	type: WhatsAppConversationType.DIRECT,
	providerChatId: jid,
	contactId: `contact-${id}`,
	contact: { id: `contact-${id}`, name: id, phoneNumber: null, avatarUrl: null },
});

function setup(opts: { available?: boolean; rows?: any[] } = {}) {
	const state = { available: opts.available ?? true };
	const provider = {
		getState: () => 'connected',
		isOnlinePresence: () => state.available,
		setOnlinePresence: jest.fn(async (on: boolean) => {
			state.available = on;
			return true;
		}),
		subscribePresence: jest.fn(async (ids: string[]) => ids.length),
		presenceTokenJids: jest.fn(async () => [] as string[]),
	};
	const providers = { getProvider: jest.fn(() => provider), onProviderEvent: () => () => undefined };
	const rows = opts.rows ?? [chatRow('a', '201000000001@c.us'), chatRow('b', '201000000002@c.us')];
	const redis = {
		isAvailable: jest.fn().mockResolvedValue(false),
		setWithIndex: jest.fn().mockResolvedValue(undefined),
		delWithIndex: jest.fn().mockResolvedValue(undefined),
		sMembers: jest.fn().mockResolvedValue([]),
		scanKeys: jest.fn().mockResolvedValue([]),
		mGet: jest.fn().mockResolvedValue([]),
	};
	const gateway = {
		emitAccountSnapshotScoped: jest.fn().mockResolvedValue(undefined),
		accountWatcherCount: jest.fn(() => 0),
		onAccountWatchersChanged: () => () => undefined,
	};
	const presence = new WhatsAppContactPresenceService(
		{ createQueryBuilder: () => qb(rows), find: jest.fn().mockResolvedValue([]) } as any,
		{ createQueryBuilder: () => qb([]) } as any,
		providers as any,
		gateway as any,
		redis as any,
	);
	return { presence, provider, providers, gateway, state };
}

const sentIds = (provider: any) => provider.subscribePresence.mock.calls.flatMap((c: any[]) => c[0]);

describe('presence subscriptions per WhatsApp connection', () => {
	it('subscribes each person once per connection, however often the inbox reloads', async () => {
		const { presence, provider } = setup();
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		const first = sentIds(provider).length;
		expect(first).toBeGreaterThan(0);
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		expect(sentIds(provider)).toHaveLength(first); // nothing re-sent
		expect(presence.diagnostics('acc-1').lastSubscribe?.result).toMatch(/already subscribed/);
	});

	it('sends only people who are new since the last pass', async () => {
		const rows = [chatRow('a', '201000000001@c.us')];
		const { presence, provider } = setup({ rows });
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		const before = sentIds(provider).length;
		rows.push(chatRow('c', '201000000003@c.us'));
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		const newOnes = sentIds(provider).slice(before);
		expect(newOnes.length).toBeGreaterThan(0);
		expect(newOnes.every((id: string) => id.includes('201000000003'))).toBe(true);
	});

	it('a reconnect (clearAccount) starts a fresh session that re-sends everyone once', async () => {
		const { presence, provider } = setup();
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		const first = sentIds(provider).length;
		presence.clearAccount('acc-1');
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		expect(sentIds(provider)).toHaveLength(first * 2);
	});

	it('defers while the device is unavailable (its answers would be fake "offline")', async () => {
		const { presence, provider } = setup({ available: false });
		await presence.subscribeRecentDirectChats('acc-1', 200, true);
		expect(provider.subscribePresence).not.toHaveBeenCalled();
		expect(presence.diagnostics('acc-1').lastSubscribe?.result).toMatch(/deferred/);
	});

	it('device going unavailable turns live rows into unknown', () => {
		const { presence } = setup();
		presence.applyPresenceEvent('acc-1', chatRow('a', '201000000001@c.us') as any, { state: 'available' });
		presence.markAccountUnconfirmed('acc-1');
		const row = (presence as any).byConversation.get('acc-1:a');
		expect(row).toMatchObject({ online: false, status: 'unknown' });
	});

	it('one person on two chats (phone + LID) is listed once, the live row winning', async () => {
		const { presence } = setup();
		const pn = { ...chatRow('pn', '201000000009@c.us'), contactId: 'same', contact: { id: 'same', name: 'Mona', phoneNumber: '201000000009', avatarUrl: null } };
		const lid = { ...pn, id: 'lid', providerChatId: '9999@lid' };
		presence.applyPresenceEvent('acc-1', lid as any, { state: 'unavailable' });
		presence.applyPresenceEvent('acc-1', pn as any, { state: 'available' });
		const items = (await presence.listOnline('acc-1', { includeOffline: true })).items;
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ conversationId: 'pn', online: true });
	});
});

describe('device availability (WhatsAppOnlinePresenceService.reconcile)', () => {
	function online(followers: boolean, viewers = 0, available = false) {
		const ctx = setup({ available });
		ctx.gateway.accountWatcherCount.mockReturnValue(viewers);
		const watch = { hasFollowers: jest.fn(async () => followers) };
		const service = new WhatsAppOnlinePresenceService(ctx.providers as any, ctx.gateway as any, ctx.presence, watch as any);
		return { ...ctx, service };
	}

	it('goes available for followed contacts with no CRM tab open, then re-sends all subscriptions', async () => {
		const { service, provider, presence } = online(true, 0, false);
		const spy = jest.spyOn(presence, 'subscribeRecentDirectChats');
		await service.reconcile('acc-1');
		expect(provider.setOnlinePresence).toHaveBeenCalledWith(true);
		expect(spy).toHaveBeenCalledWith('acc-1', 200, true, { resend: true });
	});

	it('goes unavailable when nobody watches or follows, and stops showing anyone online', async () => {
		const { service, provider, presence } = online(false, 0, true);
		const spy = jest.spyOn(presence, 'markAccountUnconfirmed');
		await service.reconcile('acc-1');
		expect(provider.setOnlinePresence).toHaveBeenCalledWith(false);
		expect(spy).toHaveBeenCalledWith('acc-1');
	});
});
