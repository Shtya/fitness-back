import { WhatsAppContactPresenceService } from './whatsapp-contact-presence.service';

/**
 * Shared mode: another server holds the WhatsApp session and writes presence to Redis;
 * this server must read it (never write) and refuse to show live status once no one holds the session.
 */
function setup(rows: Record<string, any>, { lockHeld = true } = {}) {
	const store = { ...rows };
	const redis = {
		isAvailable: jest.fn().mockResolvedValue(true),
		sMembers: jest.fn(async () => Object.keys(store)),
		mGet: jest.fn(async (keys: string[]) => keys.map((k) => store[k.split(':').pop() as string] ?? null)),
		exists: jest.fn(async () => lockHeld),
		setWithIndex: jest.fn().mockResolvedValue(undefined),
		delWithIndex: jest.fn().mockResolvedValue(undefined),
		scanKeys: jest.fn().mockResolvedValue([]),
	};
	const gateway = {
		emitAccountSnapshotScoped: jest.fn().mockResolvedValue(undefined),
		accountWatcherCount: jest.fn(() => 1),
	};
	const service = new WhatsAppContactPresenceService(
		{ find: jest.fn().mockResolvedValue([]) } as any,
		{} as any,
		{ getProvider: jest.fn(() => undefined) } as any, // this server does not own the session
		gateway as any,
		redis as any,
	);
	return { service, store, redis };
}

const row = (id: string, overrides: Record<string, any> = {}) => ({
	accountId: 'acc-1',
	conversationId: id,
	contactId: null,
	chatId: `${id}@c.us`,
	name: id,
	phoneNumber: null,
	avatarUrl: null,
	status: 'offline',
	online: false,
	typing: false,
	recording: false,
	state: 'unavailable',
	lastSeen: 0,
	updatedAt: 1_000,
	...overrides,
});

describe('WhatsAppContactPresenceService — shared Redis mode', () => {
	it('lists contacts the owning server reported online, without writing anything', async () => {
		const { service, redis } = setup({
			c1: row('c1', { status: 'online', online: true, state: 'available' }),
			c2: row('c2'),
		});
		const snap = await service.listOnline('acc-1');
		expect(snap.items.map((i) => i.conversationId)).toEqual(['c1']);
		expect(redis.setWithIndex).not.toHaveBeenCalled();
		expect(redis.delWithIndex).not.toHaveBeenCalled();
	});

	it('shows nobody as online when no server holds the session (stale rows)', async () => {
		const { service } = setup({ c1: row('c1', { status: 'online', online: true, state: 'available' }) }, { lockHeld: false });
		const snap = await service.listOnline('acc-1', { includeOffline: true });
		expect(snap.items.filter((i) => i.online)).toHaveLength(0);
		expect(service.diagnostics('acc-1').sessionOwner).toMatch(/none/);
	});

	it('picks up changes on the next read and alerts only after the baseline', async () => {
		const { service, store } = setup({ c1: row('c1') });
		const seen: string[] = [];
		service.onCameOnline((entry) => seen.push(entry.conversationId));
		await service.listOnline('acc-1'); // baseline
		store.c1 = row('c1', { status: 'online', online: true, state: 'available', updatedAt: 2_000 });
		(service as any).lastSharedRefreshAt.clear();
		const snap = await service.listOnline('acc-1');
		expect(snap.items.map((i) => i.conversationId)).toEqual(['c1']);
		expect(seen).toEqual(['c1']);
	});

	it('drops rows the owner let expire', async () => {
		const { service, store } = setup({ c1: row('c1', { status: 'online', online: true, state: 'available' }) });
		await service.listOnline('acc-1');
		delete store.c1;
		(service as any).lastSharedRefreshAt.clear();
		expect((await service.listOnline('acc-1', { includeOffline: true })).items).toHaveLength(0);
	});
});
