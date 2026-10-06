import {
	BaileysProvider,
	applyLiveChatUnread,
	attachFullMediaUrls,
	classifyBaileysDisconnect,
	computeReconnectDelayMs,
	RECONNECT_ALERT_AFTER,
	isHistoryMessageUpsert,
	mapBaileysMessageStatus,
	shouldSkipMediaReupload,
	shouldSyncFullHistory,
	writeMediaStreamToFile,
} from './baileys.provider';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

describe('Baileys media streaming (audit A7)', () => {
	it('writes the decrypted stream to disk chunk by chunk and reports the size', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'wa-media-'));
		try {
			const target = join(dir, 'clip.mp4.part');
			const chunks = [Buffer.from('abc'), Buffer.from('defg'), Buffer.alloc(1024, 1)];
			await expect(writeMediaStreamToFile(Readable.from(chunks), target)).resolves.toBe(1031);
			expect((await readFile(target)).subarray(0, 7).toString()).toBe('abcdefg');
			await expect(writeMediaStreamToFile(Readable.from([]), target)).resolves.toBe(0);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe('Baileys reconnect backoff (audit P3)', () => {
	it('grows exponentially with jitter and caps at 5 minutes', () => {
		expect(computeReconnectDelayMs(1, 0, () => 0)).toBe(1_000);
		expect(computeReconnectDelayMs(1, 0, () => 1)).toBe(2_000);
		expect(computeReconnectDelayMs(4, 0, () => 1)).toBe(16_000);
		expect(computeReconnectDelayMs(50, 0, () => 1)).toBe(300_000);
		expect(computeReconnectDelayMs(50, 0, () => 0)).toBe(150_000);
		expect(computeReconnectDelayMs(1, 8_000, () => 0)).toBe(8_000);
	});

	it('keeps retrying after repeated failures and alerts once instead of giving up', () => {
		jest.useFakeTimers();
		try {
			const provider = new BaileysProvider('account-test') as any;
			const events: any[] = [];
			provider.onEvent((event: any) => events.push(event));
			(provider as any).logger = { error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
			for (let i = 0; i < RECONNECT_ALERT_AFTER + 3; i += 1) {
				provider.scheduleReconnect();
				expect(provider.reconnectTimer).not.toBeNull();
				clearTimeout(provider.reconnectTimer);
				provider.reconnectTimer = null;
			}
			expect(provider.getState()).not.toBe('error');
			const alerts = events.filter((event) => event.reason === 'reconnect_retrying');
			expect(alerts).toHaveLength(1);
			expect(provider.logger.error).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});
});

describe('Baileys in-memory message cache bounds (audit A6)', () => {
	const remember = (provider: any, chatIndex: number, messageIndex: number) =>
		provider.rememberMessage({
			chatId: `20100000${String(chatIndex).padStart(4, '0')}@c.us`,
			providerMessageId: `c${chatIndex}-m${messageIndex}`,
			fromMe: true,
			type: 'text',
			text: 'x',
			timestamp: new Date(1_700_000_000_000 + messageIndex * 1000),
		});

	it('caps the total remembered messages across chats, evicting least-recent chats first', () => {
		const provider = new BaileysProvider('account-test') as any;
		for (let chat = 0; chat < 120; chat += 1) {
			for (let message = 0; message < 400; message += 1) remember(provider, chat, message);
		}
		let total = 0;
		for (const bucket of provider.messagesByChat.values()) total += bucket.size;

		expect(total).toBeLessThanOrEqual(40_000);
		expect(provider.rememberedMessageCount).toBe(total);
		expect(provider.messagesByChat.has('201000000119@c.us')).toBe(true);
		expect(provider.messagesByChat.has('201000000000@c.us')).toBe(false);
	});

	it('keeps the counter exact across per-chat trims, duplicates and deletes', async () => {
		const provider = new BaileysProvider('account-test') as any;
		for (let message = 0; message < 520; message += 1) remember(provider, 1, message);
		remember(provider, 1, 519);
		expect(provider.rememberedMessageCount).toBe(500);

		provider.socket = {};
		provider.state = 'connected';
		await provider.deleteMessage('201000000001@c.us', 'c1-m519', 'local');
		expect(provider.rememberedMessageCount).toBe(499);
	});
});

describe('Baileys retry receipts and group metadata (audit P3)', () => {
	it('serves getMessage from memory first, then the persisted lookup', async () => {
		const provider = new BaileysProvider('account-test') as any;
		provider.rawByMessageId.set('MEM', { key: { id: 'MEM' }, message: { conversation: 'memory' } });
		const lookup = jest.fn().mockResolvedValue({ text: 'from db', raw: null });
		provider.setMessageLookup(lookup);

		await expect(provider.getMessageForRetry({ id: 'MEM' })).resolves.toEqual({ conversation: 'memory' });
		expect(lookup).not.toHaveBeenCalled();
		await expect(provider.getMessageForRetry({ id: 'DB' })).resolves.toEqual({ conversation: 'from db' });
		expect(lookup).toHaveBeenCalledWith('DB');
		await expect(provider.getMessageForRetry({ id: '' })).resolves.toBeUndefined();
	});

	it('returns undefined when the lookup fails', async () => {
		const provider = new BaileysProvider('account-test') as any;
		provider.logger = { warn: jest.fn() };
		provider.setMessageLookup(jest.fn().mockRejectedValue(new Error('db down')));
		await expect(provider.getMessageForRetry({ id: 'X' })).resolves.toBeUndefined();
		expect(provider.logger.warn).toHaveBeenCalled();
	});

	it('caches group metadata once and ignores non-group jids', async () => {
		const provider = new BaileysProvider('account-test') as any;
		const meta = { id: '1@g.us', participants: [{ id: 'a@s.whatsapp.net' }] };
		provider.socket = { groupMetadata: jest.fn().mockResolvedValue(meta) };

		await expect(provider.getCachedGroupMetadata('1@g.us')).resolves.toBe(meta);
		await expect(provider.getCachedGroupMetadata('1@g.us')).resolves.toBe(meta);
		expect(provider.socket.groupMetadata).toHaveBeenCalledTimes(1);
		await expect(provider.getCachedGroupMetadata('201@s.whatsapp.net')).resolves.toBeUndefined();

		provider.groupMetadataCache.del('1@g.us');
		await provider.getCachedGroupMetadata('1@g.us');
		expect(provider.socket.groupMetadata).toHaveBeenCalledTimes(2);
	});
});

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
		expect((provider as any).chats.get(chatId).name).toBe('Ahmed Ibrahim');
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

describe('BaileysProvider revoke detection', () => {
	it('emits message_deleted for a REVOKE protocol message from the peer', () => {
		const provider = new BaileysProvider('account-test');
		const events: any[] = [];
		provider.onEvent(event => {
			events.push(event);
		});

		const handled = (provider as any).ingestRevoke({
			key: { remoteJid: '201000000000@s.whatsapp.net', id: 'revoke-envelope', fromMe: false },
			message: { protocolMessage: { type: 0, key: { id: 'original-1' } } },
		});

		expect(handled).toBe(true);
		expect(events).toEqual([
			{ type: 'message_deleted', providerMessageId: 'original-1', mode: 'everyone' },
		]);
	});

	it('ignores non-revoke protocol messages such as edits', () => {
		const provider = new BaileysProvider('account-test');
		const events: any[] = [];
		provider.onEvent(event => {
			events.push(event);
		});

		const handled = (provider as any).ingestRevoke({
			key: { remoteJid: '201000000000@s.whatsapp.net', id: 'edit-envelope' },
			message: { protocolMessage: { type: 14, key: { id: 'original-2' } } },
		});

		expect(handled).toBe(false);
		expect(events).toEqual([]);
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

