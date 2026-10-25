import { WhatsAppContactPresenceService } from './whatsapp-contact-presence.service';
import { WhatsAppPresenceWatchService, PRESENCE_WATCH_EVENT } from './whatsapp-presence-watch.service';
import { WhatsAppConversationType } from '../entities/whatsapp.entity';

/** In-memory stand-in for the bits of node-redis the watch service uses. */
function fakeRedis() {
	const sets = new Map<string, Set<string>>();
	const strings = new Map<string, string>();
	const set = (key: string) => {
		if (!sets.has(key)) sets.set(key, new Set());
		return sets.get(key)!;
	};
	const client = {
		multi() {
			const ops: Array<() => void> = [];
			const tx = {
				sAdd: (key: string, member: string) => (ops.push(() => set(key).add(member)), tx),
				exec: async () => ops.forEach((op) => op()),
			};
			return tx;
		},
		sRem: async (key: string, member: string) => set(key).delete(member),
		sCard: async (key: string) => set(key).size,
		set: async (key: string, value: string, opts?: { NX?: boolean }) => {
			if (opts?.NX && strings.has(key)) return null;
			strings.set(key, value);
			return 'OK';
		},
	};
	const redis = {
		isAvailable: jest.fn().mockResolvedValue(true),
		getClient: () => client,
		sMembers: async (key: string) => [...set(key)],
		// contact-presence persistence (unused by these assertions)
		setWithIndex: jest.fn().mockResolvedValue(undefined),
		delWithIndex: jest.fn().mockResolvedValue(undefined),
		scanKeys: jest.fn().mockResolvedValue([]),
		mGet: jest.fn().mockResolvedValue([]),
	};
	return { redis, strings };
}

function setup({ visible = true } = {}) {
	const { redis, strings } = fakeRedis();
	const gateway = {
		emitAccountSnapshotScoped: jest.fn().mockResolvedValue(undefined),
		emitToUser: jest.fn(),
	};
	const presence = new WhatsAppContactPresenceService(
		{ find: jest.fn().mockResolvedValue([]) } as any,
		{} as any,
		{ getProvider: jest.fn() } as any,
		gateway as any,
		redis as any,
	);
	const webPush = { sendToUser: jest.fn().mockResolvedValue([]) };
	const access = {
		assertConversationVisible: jest.fn(async () => {
			if (!visible) throw new Error('forbidden');
			return {};
		}),
	};
	const userRepo = { findOne: jest.fn(async ({ where }: any) => ({ id: where.id, role: 'admin' })) };
	const watch = new WhatsAppPresenceWatchService(
		presence,
		redis as any,
		gateway as any,
		webPush as any,
		access as any,
		userRepo as any,
	);
	watch.onModuleInit();
	return { presence, watch, gateway, webPush, access, strings };
}

const conversation = {
	id: 'conv-1',
	accountId: 'acc-1',
	type: WhatsAppConversationType.DIRECT,
	providerChatId: '201111111111@c.us',
	contactId: 'contact-1',
	contact: { id: 'contact-1', name: 'Mona', phoneNumber: '201111111111', avatarUrl: null },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('WhatsAppPresenceWatchService', () => {
	it('alerts a watcher once when the contact comes online, then holds during the cooldown', async () => {
		const { presence, watch, gateway, webPush } = setup();
		await watch.setWatch('acc-1', 'user-1', 'conv-1', true);

		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'available' });
		await flush();
		await flush();
		expect(gateway.emitToUser).toHaveBeenCalledTimes(1);
		expect(gateway.emitToUser).toHaveBeenCalledWith(
			'user-1',
			PRESENCE_WATCH_EVENT,
			expect.objectContaining({ conversationId: 'conv-1', name: 'Mona' }),
		);
		expect(webPush.sendToUser).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ title: 'Mona', tag: 'presence-conv-1' }),
		);

		// Flapping offline → online again inside the cooldown: no second alert.
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'unavailable' });
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'available' });
		await flush();
		await flush();
		expect(gateway.emitToUser).toHaveBeenCalledTimes(1);
	});

	it('does not alert for staying online or for people nobody follows', async () => {
		const { presence, watch, gateway } = setup();
		await watch.setWatch('acc-1', 'user-1', 'conv-other', true);
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'available' });
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'composing' });
		await flush();
		await flush();
		expect(gateway.emitToUser).not.toHaveBeenCalled();
	});

	it('skips watchers who can no longer see the chat', async () => {
		const { presence, watch, gateway, webPush } = setup({ visible: false });
		await watch.setWatch('acc-1', 'user-1', 'conv-1', true);
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'available' });
		await flush();
		await flush();
		expect(gateway.emitToUser).not.toHaveBeenCalled();
		expect(webPush.sendToUser).not.toHaveBeenCalled();
	});

	it('unfollowing stops alerts', async () => {
		const { presence, watch, gateway } = setup();
		await watch.setWatch('acc-1', 'user-1', 'conv-1', true);
		expect(await watch.setWatch('acc-1', 'user-1', 'conv-1', false)).toEqual([]);
		presence.applyPresenceEvent('acc-1', conversation as any, { state: 'available' });
		await flush();
		await flush();
		expect(gateway.emitToUser).not.toHaveBeenCalled();
	});

	it('refuses to save when storage is offline instead of pretending it worked', async () => {
		const { watch } = setup();
		(watch as any).redis.isAvailable.mockResolvedValue(false);
		await expect(watch.setWatch('acc-1', 'user-1', 'conv-1', true)).rejects.toThrow(/Nothing was saved/);
	});
});
