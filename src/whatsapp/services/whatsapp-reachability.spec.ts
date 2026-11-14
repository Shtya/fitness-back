import { BadRequestException } from '@nestjs/common';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const CHAT = '201009437066@s.whatsapp.net';

function service(opts: {
	chatId?: string;
	connected?: boolean;
	presence?: { online?: boolean; lastSeen?: number; updatedAt?: number } | null;
	onWhatsApp?: boolean;
	lastOutbound?: { status: string; providerTimestamp: Date } | null;
	lastDelivered?: { status: string; providerTimestamp: Date } | null;
}) {
	const subscribePresence = jest.fn(async () => undefined);
	const self: any = Object.create(WhatsAppSyncService.prototype);
	let call = 0;
	Object.assign(self, {
		access: {
			assertConversationVisible: jest.fn(async () => ({
				conversation: { id: 'c1', accountId: 'acc', providerChatId: opts.chatId || CHAT, contactId: null },
			})),
		},
		contactRepo: { findOne: jest.fn(async () => null) },
		messageRepo: {
			findOne: jest.fn(async () => (call++ === 0 ? opts.lastOutbound ?? null : opts.lastDelivered ?? null)),
		},
		providers: {
			getProvider: jest.fn(() => ({
				getState: () => (opts.connected === false ? 'disconnected' : 'connected'),
				subscribePresence,
				checkWhatsAppNumbers: jest.fn(async () => [{ exists: opts.onWhatsApp !== false }]),
			})),
		},
		contactPresence: {
			getMemorySnapshot: jest.fn(() =>
				opts.presence
					? [{ conversationId: 'c1', online: Boolean(opts.presence.online), lastSeen: opts.presence.lastSeen || 0, updatedAt: opts.presence.updatedAt ?? Date.now() + 1000 }]
					: [],
			),
		},
	});
	return { self, subscribePresence };
}

const user: any = { id: 'u1' };
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

describe('check connection with a contact', () => {
	it('says online when WhatsApp reports them online', async () => {
		const { self, subscribePresence } = service({ presence: { online: true } });
		const result = await self.checkConversationReachability(user, 'c1');
		expect(result.verdict).toBe('online');
		expect(subscribePresence).toHaveBeenCalled();
	});

	it('flags a last message stuck on one tick: their phone is not receiving', async () => {
		const { self } = service({
			presence: null,
			lastOutbound: { status: 'sent', providerTimestamp: minutesAgo(30) },
			lastDelivered: { status: 'read', providerTimestamp: minutesAgo(600) },
		});
		const result = await self.checkConversationReachability(user, 'c1');
		expect(result.verdict).toBe('one_tick');
		expect(result.lastMessage.status).toBe('sent');
		// when they last did get one: shown so you know how long they have been unreachable
		expect(new Date(result.lastDeliveredAt).getTime()).toBeLessThan(Date.now() - 500 * 60_000);
	});

	it('says reachable when the last message got two ticks', async () => {
		const { self } = service({ lastOutbound: { status: 'delivered', providerTimestamp: minutesAgo(5) } });
		expect((await self.checkConversationReachability(user, 'c1')).verdict).toBe('reachable');
	});

	it('does not call a message sent a few seconds ago stuck', async () => {
		const { self } = service({ lastOutbound: { status: 'sent', providerTimestamp: minutesAgo(0.2) } });
		expect((await self.checkConversationReachability(user, 'c1')).verdict).toBe('unknown');
	});

	it('reports a number that is not on WhatsApp, and an offline session', async () => {
		expect((await service({ onWhatsApp: false }).self.checkConversationReachability(user, 'c1')).verdict).toBe(
			'not_on_whatsapp',
		);
		expect((await service({ connected: false }).self.checkConversationReachability(user, 'c1')).verdict).toBe(
			'session_offline',
		);
	});

	it('refuses groups', async () => {
		await expect(
			service({ chatId: '1203630@g.us' }).self.checkConversationReachability(user, 'c1'),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});
