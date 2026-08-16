import { BaileysProvider, classifyBaileysDisconnect } from './baileys.provider';

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

describe('classifyBaileysDisconnect', () => {
	it('treats conflict/replaced as a session replacement, not a closed phone', () => {
		expect(
			classifyBaileysDisconnect({
				lastDisconnect: { error: { message: 'Stream Errored (conflict)' } },
			}),
		).toBe('replaced');
		expect(
			classifyBaileysDisconnect({
				lastDisconnect: { error: { output: { statusCode: 440 } } },
			}),
		).toBe('replaced');
		expect(
			classifyBaileysDisconnect({
				lastDisconnect: {
					error: {
						data: { content: [{ tag: 'conflict', attrs: { type: 'replaced' } }] },
					},
				},
			}),
		).toBe('replaced');
	});

	it('still recognizes a real phone/network drop and a logout', () => {
		expect(
			classifyBaileysDisconnect({
				lastDisconnect: { error: { output: { statusCode: 428 } } },
			}),
		).toBe('phone_closed');
		expect(
			classifyBaileysDisconnect({
				lastDisconnect: { error: { output: { statusCode: 401 } } },
			}),
		).toBe('logged_out');
		expect(
			classifyBaileysDisconnect(
				{
					lastDisconnect: {
						error: {
							message: 'Connection Failure',
							output: { statusCode: 401 },
						},
					},
				},
				{ loggedOut: 401 },
			),
		).toBe('connection_lost');
		expect(
			classifyBaileysDisconnect(
				{
					lastDisconnect: {
						error: {
							message: 'Connection Failure',
							output: { statusCode: 401 },
						},
					},
				},
				{ loggedOut: 401 },
				{ sessionHadOpened: true },
			),
		).toBe('logged_out');
	});
});
