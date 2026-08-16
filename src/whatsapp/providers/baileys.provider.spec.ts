import {
	BaileysProvider,
	applyLiveChatUnread,
	classifyBaileysDisconnect,
	isHistoryMessageUpsert,
	mapBaileysMessageStatus,
} from './baileys.provider';

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

describe('BaileysProvider stories', () => {
	it('collects status@broadcast messages instead of dropping them', async () => {
		const provider = new BaileysProvider('account-stories');
		(provider as any).state = 'connected';
		const raw = {
			key: {
				remoteJid: 'status@broadcast',
				id: '3EB0ABCDEF1234',
				fromMe: false,
				participant: '201551495772@s.whatsapp.net',
			},
			pushName: 'Ahmed',
			messageTimestamp: Math.floor(Date.now() / 1000),
			message: {
				imageMessage: { caption: 'hello story', mimetype: 'image/jpeg' },
			},
		};

		expect((provider as any).rememberStatus(raw)).toBe(true);
		expect((provider as any).normalizeWaMessage(raw)).toBeNull();

		const statuses = await provider.getStatuses();
		expect(statuses).toHaveLength(1);
		expect(statuses[0].id._serialized).toContain('status@broadcast_3EB0ABCDEF1234');
		expect(statuses[0].author._serialized).toBe('201551495772@c.us');
		expect(statuses[0].type).toBe('image');
		expect(statuses[0].caption).toBe('hello story');
		expect(statuses[0].contactName).toBe('Ahmed');
	});

	it('does not leak stories into the chat inbox', () => {
		const provider = new BaileysProvider('account-stories-inbox');
		const chatId = 'status@broadcast';
		(provider as any).rememberChat(chatId, { name: 'Status' });
		expect((provider as any).chats.has(chatId)).toBe(false);
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

describe('Baileys phone-read unread signals', () => {
	it('treats explicit unreadCount 0 as read on the phone', () => {
		expect(applyLiveChatUnread(4, 0)).toEqual({ next: 0, phoneRead: true });
		expect(applyLiveChatUnread(4, null)).toEqual({ next: 4, phoneRead: false });
		expect(applyLiveChatUnread(4, 2)).toEqual({ next: 2, phoneRead: false });
		expect(applyLiveChatUnread(4, -1)).toEqual({ next: 4, phoneRead: false });
	});

	it('treats a recent fromMe append as a live phone echo, not history', () => {
		const recent = {
			key: { fromMe: true, id: 'ABC' },
			messageTimestamp: Math.floor(Date.now() / 1000),
		};
		expect(isHistoryMessageUpsert('append', recent)).toBe(false);
		expect(isHistoryMessageUpsert('notify', { key: { fromMe: false } })).toBe(false);
		expect(isHistoryMessageUpsert('append', { key: { fromMe: false } })).toBe(true);
		expect(
			isHistoryMessageUpsert('append', {
				key: { fromMe: true },
				messageTimestamp: Math.floor(Date.now() / 1000) - 60 * 60,
			}),
		).toBe(true);
	});

	it('maps proto ack numbers to WhatsApp ticks, not the swapped statuses', () => {
		expect(mapBaileysMessageStatus(2)).toBe('sent');
		expect(mapBaileysMessageStatus(3)).toBe('delivered');
		expect(mapBaileysMessageStatus(4)).toBe('read');
		expect(mapBaileysMessageStatus(5)).toBe('played');
		expect(mapBaileysMessageStatus('DELIVERY_ACK')).toBe('delivered');
		expect(mapBaileysMessageStatus('READ')).toBe('read');
	});
});

describe('BaileysProvider WhatsApp channels', () => {
	it('resolves a newsletter title from metadata instead of returning Chat', async () => {
		const provider = new BaileysProvider('account-channel');
		const channelId = '120363163799333272@newsletter';
		(provider as any).state = 'connected';
		(provider as any).socket = {
			newsletterMetadata: jest.fn(async () => ({
				thread_metadata: {
					name: { text: 'أسعار العملات اليوم' },
					preview: { direct_path: '/v/t61.24694-24/channel.jpg' },
				},
			})),
			profilePictureUrl: jest.fn(),
		};
		(provider as any).rememberChat(channelId, { t: Date.now() / 1000 });

		const identity = await provider.resolveContactIdentity(channelId);
		expect(identity).toEqual({
			phoneNumber: null,
			name: 'أسعار العملات اليوم',
		});

		const chats = await provider.getChats(10);
		expect(chats[0].name).toBe('أسعار العملات اليوم');
		expect(chats[0].imgUrl).toBe('https://pps.whatsapp.net/v/t61.24694-24/channel.jpg');
		expect((provider as any).socket.newsletterMetadata).toHaveBeenCalledTimes(1);
		expect((provider as any).socket.profilePictureUrl).not.toHaveBeenCalled();
	});
});

