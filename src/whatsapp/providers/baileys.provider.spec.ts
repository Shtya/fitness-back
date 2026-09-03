import {
	BaileysProvider,
	applyLiveChatUnread,
	attachFullMediaUrls,
	classifyBaileysDisconnect,
	isHistoryMessageUpsert,
	mapBaileysMessageStatus,
	shouldSkipMediaReupload,
	shouldSyncFullHistory,
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

	it('honors before cursor instead of always returning the latest page', async () => {
		const provider = new BaileysProvider('account-test');
		const chatId = '201000000000@c.us';
		(provider as any).messagesByChat.set(
			chatId,
			new Map([
				[
					'msg-old',
					{
						providerMessageId: 'msg-old',
						chatId,
						timestamp: new Date('2026-08-15T12:00:00Z'),
					},
				],
				[
					'msg-mid',
					{
						providerMessageId: 'msg-mid',
						chatId,
						timestamp: new Date('2026-08-15T12:10:00Z'),
					},
				],
				[
					'msg-new',
					{
						providerMessageId: 'msg-new',
						chatId,
						timestamp: new Date('2026-08-15T12:20:00Z'),
					},
				],
			]),
		);

		const older = await provider.getMessages(chatId, { before: 'msg-new', limit: 50 });
		expect(older.map((item) => item.providerMessageId)).toEqual(['msg-old', 'msg-mid']);
		await expect(provider.getMessages(chatId, { before: 'missing' })).resolves.toEqual([]);
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

	it('keeps address-book name above message pushName', () => {
		const provider = new BaileysProvider('account-contact-priority');
		const chatId = '201551495772@c.us';
		(provider as any).rememberContact({
			id: chatId,
			name: 'Ahmed Ibrahim',
			notify: 'yassinnasser',
		});
		(provider as any).rememberContact({
			id: chatId,
			notify: 'aaaaaaaaasa211',
		});
		expect((provider as any).contactDisplayName(chatId)).toBe('Ahmed Ibrahim');
		expect((provider as any).contacts.get(chatId).notify).toBe('aaaaaaaaasa211');
	});

	it('uses WhatsApp display name when the peer is not saved', () => {
		const provider = new BaileysProvider('account-contact-push');
		const chatId = '201000000001@c.us';
		(provider as any).rememberContact({
			id: chatId,
			notify: 'ادارة التغيير تبدأ من داخلك',
		});
		expect((provider as any).contactDisplayName(chatId)).toBe(
			'ادارة التغيير تبدأ من داخلك',
		);
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

	it('remembers history.set ids so duplicate append upserts can be skipped', () => {
		const provider = new BaileysProvider('account-history-dedupe');
		(provider as any).rememberHistoryMessageId('MSG-HISTORY-1');
		expect((provider as any).recentHistoryMessageIds.has('MSG-HISTORY-1')).toBe(true);
	});

	it('keeps full history opt-in', () => {
		const previous = process.env.WHATSAPP_SYNC_FULL_HISTORY;
		delete process.env.WHATSAPP_SYNC_FULL_HISTORY;
		expect(shouldSyncFullHistory()).toBe(false);
		process.env.WHATSAPP_SYNC_FULL_HISTORY = 'true';
		expect(shouldSyncFullHistory()).toBe(true);
		if (previous == null) delete process.env.WHATSAPP_SYNC_FULL_HISTORY;
		else process.env.WHATSAPP_SYNC_FULL_HISTORY = previous;
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

describe('BaileysProvider media download helpers', () => {
	it('skips phone re-upload for status@broadcast media', () => {
		expect(
			shouldSkipMediaReupload({
				key: { remoteJid: 'status@broadcast', id: '3EB0ABC' },
			}),
		).toBe(true);
		expect(
			shouldSkipMediaReupload({
				key: { remoteJid: '201551495772@s.whatsapp.net', id: 'CHAT1' },
			}),
		).toBe(false);
	});

	it('fills url from directPath so Baileys does not download thumbnailDirectPath', () => {
		const content: any = {
			imageMessage: {
				directPath: '/v/t62.7118-24/full.jpg',
				thumbnailDirectPath: '/v/t62.7118-24/thumb.jpg',
				mediaKey: Buffer.from('key'),
			},
		};
		attachFullMediaUrls(content, (directPath) => `https://mmg.whatsapp.net${directPath}`);
		expect(content.imageMessage.url).toBe('https://mmg.whatsapp.net/v/t62.7118-24/full.jpg');
	});
});

describe('BaileysProvider message actions', () => {
	it('forwards from in-memory raw and remembers the new message', async () => {
		const provider = new BaileysProvider('account-test');
		const sendMessage = jest.fn().mockResolvedValue({
			key: { remoteJid: '201000000001@s.whatsapp.net', id: 'fwd-1', fromMe: true },
			message: { conversation: 'hello' },
			messageTimestamp: Math.floor(Date.now() / 1000),
		});
		(provider as any).state = 'connected';
		(provider as any).socket = { sendMessage };
		(provider as any).rawByMessageId.set('src-1', {
			key: { remoteJid: '201000000000@s.whatsapp.net', id: 'src-1', fromMe: false },
			message: { conversation: 'hello' },
		});
		(provider as any).normalizeWaMessage = () => ({
			providerMessageId: 'fwd-1',
			chatId: '201000000001@c.us',
			fromMe: true,
			type: 'chat',
			text: 'hello',
			timestamp: new Date(),
		});
		(provider as any).rememberMessage = jest.fn();

		await provider.forwardMessage('201000000001@c.us', 'src-1');

		expect(sendMessage).toHaveBeenCalledWith(
			'201000000001@s.whatsapp.net',
			expect.objectContaining({
				forward: expect.objectContaining({
					key: expect.objectContaining({ id: 'src-1' }),
				}),
			}),
		);
	});

	it('forwards from a stored raw hint when the live cache is empty', async () => {
		const provider = new BaileysProvider('account-test');
		const sendMessage = jest.fn().mockResolvedValue({ key: { id: 'fwd-2' } });
		(provider as any).state = 'connected';
		(provider as any).socket = { sendMessage };
		(provider as any).normalizeWaMessage = () => null;

		await provider.forwardMessage('201000000001@c.us', 'src-2', {
			rawHint: {
				key: { remoteJid: '201000000000@s.whatsapp.net', id: 'src-2', fromMe: false },
				message: { conversation: 'saved' },
			},
		});

		expect(sendMessage).toHaveBeenCalledWith(
			'201000000001@s.whatsapp.net',
			expect.objectContaining({
				forward: expect.objectContaining({
					message: { conversation: 'saved' },
				}),
			}),
		);
	});

	it('revokes outbound messages for everyone and hides them locally', async () => {
		const provider = new BaileysProvider('account-test');
		const sendMessage = jest.fn().mockResolvedValue({ ok: true });
		(provider as any).state = 'connected';
		(provider as any).socket = { sendMessage };
		const bucket = new Map([['msg-del', { providerMessageId: 'msg-del' }]]);
		(provider as any).messagesByChat.set('201000000000@c.us', bucket);
		(provider as any).rawByMessageId.set('msg-del', {
			key: {
				remoteJid: '201000000000@s.whatsapp.net',
				id: 'msg-del',
				fromMe: true,
			},
		});

		await provider.deleteMessage('201000000000@c.us', 'msg-del', 'everyone');

		expect(sendMessage).toHaveBeenCalledWith(
			'201000000000@s.whatsapp.net',
			expect.objectContaining({
				delete: expect.objectContaining({ id: 'msg-del', fromMe: true }),
			}),
		);
		expect(bucket.has('msg-del')).toBe(false);
	});

	it('sends text replies with quoted in Baileys options, not content', async () => {
		const provider = new BaileysProvider('account-test');
		const sendMessage = jest.fn().mockResolvedValue({
			key: { remoteJid: '201000000001@s.whatsapp.net', id: 'reply-1', fromMe: true },
			message: { conversation: 'done' },
			messageTimestamp: Math.floor(Date.now() / 1000),
		});
		(provider as any).state = 'connected';
		(provider as any).socket = { sendMessage };
		(provider as any).rawByMessageId.set('src-quote', {
			key: {
				remoteJid: '201000000001@s.whatsapp.net',
				id: 'src-quote',
				fromMe: false,
			},
			message: { conversation: 'Please update the report' },
		});
		(provider as any).normalizeWaMessage = () => ({
			providerMessageId: 'reply-1',
			chatId: '201000000001@c.us',
			fromMe: true,
			type: 'chat',
			text: 'done',
			timestamp: new Date(),
		});
		(provider as any).rememberMessage = jest.fn();

		await provider.sendText('201000000001@c.us', 'done', 'src-quote');

		expect(sendMessage).toHaveBeenCalledWith(
			'201000000001@s.whatsapp.net',
			{ text: 'done' },
			expect.objectContaining({
				quoted: expect.objectContaining({
					key: expect.objectContaining({ id: 'src-quote' }),
				}),
			}),
		);
		const contentArg = sendMessage.mock.calls[0][1];
		expect(contentArg.quoted).toBeUndefined();
	});
});

