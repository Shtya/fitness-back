import { BaileysProvider } from './baileys.provider';

describe('BaileysProvider inbox lookup', () => {
	it('returns messages stored under LID when querying the phone JID', async () => {
		const provider = new BaileysProvider('account-test');
		const lid = '123456789012345@lid';
		const phone = '201551495772';
		const normalized = {
			providerMessageId: 'msg-1',
			chatId: lid,
			fromMe: false,
			type: 'ptt',
			text: null,
			timestamp: new Date('2026-08-15T12:18:00Z'),
		};
		(provider as any).lidToPn.set(lid, phone);
		(provider as any).messagesByChat.set(lid, new Map([['msg-1', normalized]]));

		const messages = await provider.getMessages(`${phone}@c.us`);

		expect(messages).toHaveLength(1);
		expect(messages[0].providerMessageId).toBe('msg-1');
	});

	it('does not mark history ready on socket-open before WhatsApp sends chats', async () => {
		const provider = new BaileysProvider('account-test');
		(provider as any).state = 'connected';
		(provider as any).connectedAtMs = Date.now();

		await expect(provider.isHistoryReady()).resolves.toBe(false);

		(provider as any).historySyncChunks = 1;
		await expect(provider.isHistoryReady()).resolves.toBe(true);
	});
});
