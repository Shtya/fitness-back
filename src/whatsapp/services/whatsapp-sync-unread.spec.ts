import {
	isSupportedInboxChatId,
	providerChatActivityMs,
	providerUnreadCount,
} from './whatsapp-sync.service';

describe('providerUnreadCount', () => {
	it('uses the provider unread count including zero', () => {
		expect(providerUnreadCount({ unreadCount: 0 })).toBe(0);
		expect(providerUnreadCount({ unreadCount: 80 })).toBe(80);
	});

	it('supports alternate provider fields and normalizes invalid values', () => {
		expect(providerUnreadCount({ unreadMessages: '3' })).toBe(3);
		expect(providerUnreadCount({ countUnreadMessages: -2 })).toBe(0);
		expect(providerUnreadCount({ unreadCount: 'invalid' })).toBeNull();
		expect(providerUnreadCount({})).toBeNull();
	});
});

describe('isSupportedInboxChatId', () => {
	it('keeps direct chats and groups', () => {
		expect(isSupportedInboxChatId('201000000000@c.us')).toBe(true);
		expect(isSupportedInboxChatId('120363000000000000@g.us')).toBe(true);
		expect(isSupportedInboxChatId('123456789@lid')).toBe(true);
	});

	it('rejects channels, statuses and broadcast lists', () => {
		expect(isSupportedInboxChatId('120363000000000000@newsletter')).toBe(false);
		expect(isSupportedInboxChatId('status@broadcast')).toBe(false);
		expect(isSupportedInboxChatId('123456@broadcast')).toBe(false);
	});
});

describe('providerChatActivityMs', () => {
	it('uses the last real message before mutable chat metadata', () => {
		const realMessageTime = 1_700_000_000;
		const misleadingChatTime = 1_750_000_000;
		expect(
			providerChatActivityMs({
				t: misleadingChatTime,
				lastMessage: { t: realMessageTime },
			}),
		).toBe(realMessageTime * 1000);
	});

	it('supports provider message collections and falls back to chat time', () => {
		expect(
			providerChatActivityMs({
				t: 1_700_000_000,
				msgs: {
					last: () => ({ timestamp: 1_710_000_000 }),
				},
			}),
		).toBe(1_710_000_000_000);
		expect(providerChatActivityMs({ t: 1_700_000_000 })).toBe(1_700_000_000_000);
	});
});
