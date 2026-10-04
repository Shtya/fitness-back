import {
	WhatsAppSyncService,
	parseConversationDeltaSince,
	toSafeMediaFileName,
} from './whatsapp-sync.service';

describe('toSafeMediaFileName (ENAMETOOLONG on Arabic captions)', () => {
	it('keeps short ASCII names and their extension', () => {
		expect(toSafeMediaFileName('photo 1.jpg')).toBe('photo_1.jpg');
		expect(toSafeMediaFileName('../../etc/passwd')).toBe('passwd');
	});

	it('collapses non-Latin names to the fallback and keeps the extension', () => {
		expect(toSafeMediaFileName('صورة التمرين.jpeg')).toBe('attachment.jpeg');
		expect(toSafeMediaFileName('', 'file')).toBe('file');
		expect(toSafeMediaFileName(null)).toBe('attachment');
	});

	it('stays far below the 255-byte filename limit for long captions', () => {
		const caption = `${'تمرين '.repeat(60)}AI ${'ا'.repeat(80)}..`;
		const name = toSafeMediaFileName(caption);
		expect(name).toBe('AI');
		const long = toSafeMediaFileName(`${'a'.repeat(400)}.mp4`);
		expect(long.endsWith('.mp4')).toBe(true);
		expect(`${'0'.repeat(36)}-${long}.12345678.part`.length).toBeLessThan(255);
	});
});

describe('parseConversationDeltaSince (reconnect delta, P3)', () => {
	const now = Date.parse('2026-09-28T12:00:00Z');

	it('accepts a recent ISO timestamp', () => {
		expect(parseConversationDeltaSince('2026-09-28T11:50:00Z', now)?.toISOString()).toBe(
			'2026-09-28T11:50:00.000Z',
		);
	});

	it('ignores empty, invalid, future, and older-than-7-days values', () => {
		expect(parseConversationDeltaSince('', now)).toBeNull();
		expect(parseConversationDeltaSince('not-a-date', now)).toBeNull();
		expect(parseConversationDeltaSince('2026-09-28T12:05:00Z', now)).toBeNull();
		expect(parseConversationDeltaSince('2026-09-20T12:00:00Z', now)).toBeNull();
	});
});
import { prepareMessagesForClient } from '../utils/whatsapp-client-payload';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('WhatsAppSyncService read paths (audit P2)', () => {
	function createService(overrides: { provider?: any } = {}) {
		const conversationRepo = {
			findOne: jest.fn().mockResolvedValue({
				id: 'conversation-1',
				assignedUserId: null,
				providerChatId: '201000000000@c.us',
			}),
		};
		const messageRepo = {
			query: jest.fn().mockResolvedValue([]),
			update: jest.fn().mockResolvedValue(undefined),
		};
		const attachmentRepo = { find: jest.fn().mockResolvedValue([]) };
		const access: any = {
			assertConversationVisible: jest.fn().mockResolvedValue({}),
			getAccountSnapshot: jest.fn(),
		};
		const providers = { getProvider: jest.fn().mockReturnValue(overrides.provider ?? null) };
		const gateway = { emitAccountEvent: jest.fn(), emitConversationEvent: jest.fn() };
		const service = new WhatsAppSyncService(
			{} as any, // accountRepo
			{} as any, // contactRepo
			conversationRepo as any,
			{} as any, // noteRepo
			{} as any, // groupRepo
			{} as any, // participantRepo
			messageRepo as any,
			attachmentRepo as any,
			{} as any, // reactionRepo
			access,
			providers as any,
			gateway as any,
			{} as any, // audit
			{} as any, // notifications
			{} as any, // statusService
			{} as any, // contactPresence
			{} as any, // preferenceRepo
		);
		return { service, conversationRepo, messageRepo, attachmentRepo, access, providers, gateway };
	}

	describe('findLastPreviewMessages', () => {
		it('skips the query for an empty page', async () => {
			const { service, messageRepo } = createService();
			const result = await (service as any).findLastPreviewMessages([]);
			expect(result.size).toBe(0);
			expect(messageRepo.query).not.toHaveBeenCalled();
		});

		it('uses one LATERAL LIMIT 1 query and maps rows by conversation', async () => {
			const { service, messageRepo } = createService();
			const at = new Date('2026-09-28T10:00:00Z');
			messageRepo.query.mockResolvedValue([
				{
					conversationId: 'c1',
					id: 'm1',
					providerMessageId: 'P1',
					text: 'hi',
					type: 'text',
					direction: 'inbound',
					status: 'read',
					providerTimestamp: at,
				},
			]);

			const result = await (service as any).findLastPreviewMessages(['c1', 'c2']);

			expect(messageRepo.query).toHaveBeenCalledTimes(1);
			const [sql, params] = messageRepo.query.mock.calls[0];
			expect(sql).toMatch(/CROSS JOIN LATERAL/);
			expect(sql).toMatch(/ORDER BY m\.provider_timestamp DESC, m\.created_at DESC\s+LIMIT 1/);
			expect(sql).not.toMatch(/\braw\b/);
			expect(params[0]).toEqual(['c1', 'c2']);
			expect(params[1]).toContain('sticker');
			expect(result.get('c1')).toEqual({
				id: 'm1',
				providerMessageId: 'P1',
				text: 'hi',
				type: 'text',
				direction: 'inbound',
				status: 'read',
				providerTimestamp: at,
			});
			expect(result.has('c2')).toBe(false);
		});
	});

	describe('visibleAttachmentsById', () => {
		const idA = '11111111-1111-1111-1111-111111111111';
		const idB = '22222222-2222-2222-2222-222222222222';
		const idC = '33333333-3333-3333-3333-333333333333';

		it('loads all attachments once and checks each conversation once', async () => {
			const { service, attachmentRepo, access } = createService();
			attachmentRepo.find.mockResolvedValue([
				{ id: idA, message: { conversationId: 'visible' } },
				{ id: idB, message: { conversationId: 'visible' } },
				{ id: idC, message: { conversationId: 'hidden' } },
			]);
			access.assertConversationVisible.mockImplementation(async (_user: any, id: string) => {
				if (id === 'hidden') throw new Error('denied');
				return {};
			});

			const result = await service.visibleAttachmentsById({ id: 'u1' } as any, [idA, idB, idC]);

			expect(attachmentRepo.find).toHaveBeenCalledTimes(1);
			expect(access.assertConversationVisible).toHaveBeenCalledTimes(2);
			expect([...result.keys()].sort()).toEqual([idA, idB]);
		});

		it('drops malformed ids instead of failing the whole batch', async () => {
			const { service, attachmentRepo } = createService();
			await service.visibleAttachmentsById({ id: 'u1' } as any, ['not-a-uuid', idA]);
			const where = attachmentRepo.find.mock.calls[0][0].where;
			expect(where.id.value).toEqual([idA]);

			attachmentRepo.find.mockClear();
			const empty = await service.visibleAttachmentsById({ id: 'u1' } as any, ['bad']);
			expect(empty.size).toBe(0);
			expect(attachmentRepo.find).not.toHaveBeenCalled();
		});
	});

	describe('background shared-contact hydration', () => {
		const conversation = {
			id: 'conversation-1',
			accountId: 'account-1',
			providerChatId: '201000000000@c.us',
		} as any;

		function contactCardWithoutPhone() {
			return {
				id: 'message-1',
				providerMessageId: 'P1',
				type: 'contact',
				text: 'Ali',
				raw: { mediaKey: 'SECRET', message: { contactMessage: { displayName: 'Ali' } } },
			} as any;
		}

		it('does not block the caller and fetches each card at most once per TTL', async () => {
			let resolveFetch: (value: any) => void = () => undefined;
			const provider = {
				findMessage: jest.fn().mockReturnValue(null),
				fetchMessage: jest.fn(() => new Promise((resolve) => (resolveFetch = resolve))),
			};
			const { service } = createService({ provider });

			const returned = (service as any).scheduleLiveContactHydration(conversation, [
				contactCardWithoutPhone(),
			]);
			(service as any).scheduleLiveContactHydration(conversation, [contactCardWithoutPhone()]);

			expect(returned).toBeUndefined();
			expect(provider.fetchMessage).toHaveBeenCalledTimes(1);
			resolveFetch(null);
		});

		it('persists the full raw and pushes a redacted message_updated patch', async () => {
			const provider = {
				findMessage: jest.fn().mockReturnValue(null),
				fetchMessage: jest.fn().mockResolvedValue({
					type: 'contact',
					text: 'Ali',
					raw: { contact: { displayName: 'Ali', phoneNumber: '+201000000000' } },
				}),
			};
			const { service, messageRepo, gateway } = createService({ provider });
			const message = contactCardWithoutPhone();

			(service as any).scheduleLiveContactHydration(conversation, [message]);
			// The response path redacts the original right after scheduling.
			prepareMessagesForClient([message]);
			await new Promise((resolve) => setImmediate(resolve));
			await new Promise((resolve) => setImmediate(resolve));

			expect(messageRepo.update).toHaveBeenCalledTimes(1);
			const [id, updates] = messageRepo.update.mock.calls[0];
			expect(id).toBe('message-1');
			expect(updates.raw.mediaKey).toBe('SECRET');
			expect(updates.raw.sharedContact.phones.length).toBeGreaterThan(0);

			expect(gateway.emitConversationEvent).toHaveBeenCalledTimes(1);
			const [conversationId, event, payload] = gateway.emitConversationEvent.mock.calls[0];
			expect(conversationId).toBe('conversation-1');
			expect(event).toBe('message_updated');
			expect(payload.messageId).toBe('message-1');
			expect(payload.changes.type).toBe('contact');
			expect(payload.changes.sharedContact.phones.length).toBeGreaterThan(0);
			expect(JSON.stringify(payload.changes.raw)).not.toContain('SECRET');
		});

		it('does nothing without a live provider', () => {
			const { service, messageRepo } = createService({ provider: null });
			(service as any).scheduleLiveContactHydration(conversation, [contactCardWithoutPhone()]);
			expect(messageRepo.update).not.toHaveBeenCalled();
			expect((service as any).liveContactFetchAt.size).toBe(0);
		});
	});

	describe('conversation hot cache', () => {
		function cachedConversation(id: string, providerChatId: string) {
			return {
				id,
				accountId: 'account-1',
				providerChatId,
				contact: { id: `contact-${id}`, name: 'Ali', phoneNumber: '201000000000' },
			} as any;
		}

		it('serves title/phone hits without a preference rebind UPDATE', async () => {
			const { service } = createService();
			const rebind = jest
				.spyOn(service as any, 'rebindConversationPreferences')
				.mockResolvedValue(undefined);
			const conversation = cachedConversation('c1', '201000000000@c.us');
			(service as any).rememberConversation('account-1', '201000000000@c.us', conversation);

			const result = await (service as any).ensureConversation('account-1', '201000000000@c.us', {
				title: 'Ali',
				phone: '201000000000',
			});

			expect(result).toBe(conversation);
			expect(rebind).not.toHaveBeenCalled();
		});

		it('drops expired entries instead of serving them', async () => {
			const { service, conversationRepo } = createService();
			jest.spyOn(service as any, 'rebindConversationPreferences').mockResolvedValue(undefined);
			const stale = cachedConversation('c1', '201000000000@c.us');
			(service as any).rememberConversation('account-1', '201000000000@c.us', stale);
			(service as any).conversationHotCache.get('account-1:201000000000@c.us').at -= 61_000;
			const fresh = cachedConversation('c1', '201000000000@c.us');
			conversationRepo.findOne.mockResolvedValue(fresh);

			const result = await (service as any).ensureConversation('account-1', '201000000000@c.us');

			expect(conversationRepo.findOne).toHaveBeenCalledTimes(1);
			expect(result).toBe(fresh);
		});

		it('sweeps expired entries from the front when a new conversation is remembered (audit A14)', () => {
			const { service } = createService();
			const cache: Map<string, { at: number }> = (service as any).conversationHotCache;
			(service as any).rememberConversation('account-1', 'old-1@c.us', cachedConversation('o1', 'old-1@c.us'));
			(service as any).rememberConversation('account-1', 'old-2@c.us', cachedConversation('o2', 'old-2@c.us'));
			(service as any).rememberConversation('account-1', 'recent@c.us', cachedConversation('r1', 'recent@c.us'));
			cache.get('account-1:old-1@c.us')!.at -= 120_000;
			cache.get('account-1:old-2@c.us')!.at -= 61_000;

			(service as any).rememberConversation('account-1', 'new@c.us', cachedConversation('n1', 'new@c.us'));

			expect([...cache.keys()]).toEqual(['account-1:recent@c.us', 'account-1:new@c.us']);
		});

		it('caps the cache size and evicts least recently remembered first', () => {
			const { service } = createService();
			const cache: Map<string, unknown> = (service as any).conversationHotCache;
			for (let i = 0; i < 5001; i += 1) {
				(service as any).rememberConversation('account-1', `chat-${i}`, cachedConversation(`c${i}`, `chat-${i}`));
			}
			expect(cache.size).toBe(5000);
			expect(cache.has('account-1:chat-0')).toBe(false);

			(service as any).rememberConversation('account-1', 'chat-1', cachedConversation('c1', 'chat-1'));
			(service as any).rememberConversation('account-1', 'chat-new', cachedConversation('cn', 'chat-new'));
			expect(cache.has('account-1:chat-1')).toBe(true);
			expect(cache.has('account-1:chat-2')).toBe(false);
		});

		it('forgets the providerChatId alias together with the lookup key', () => {
			const { service } = createService();
			const cache: Map<string, unknown> = (service as any).conversationHotCache;
			(service as any).rememberConversation('account-1', '123@lid', cachedConversation('c1', '201000000000@c.us'));
			expect(cache.size).toBe(2);

			(service as any).forgetConversation('account-1', '123@lid');

			expect(cache.size).toBe(0);
		});
	});

	describe('resolveAttachmentFile Range burst cache (audit A7)', () => {
		const resolved = {
			absolutePath: __filename,
			mimeType: 'video/mp4',
			fileName: 'clip.mp4',
		};

		it('runs visibility and lookups once per user for repeated Range requests', async () => {
			const { service } = createService();
			const uncached = jest
				.spyOn(service as any, 'resolveAttachmentFileUncached')
				.mockResolvedValue(resolved);
			const user = { id: 'user-1' } as any;

			await expect(service.resolveAttachmentFile(user, 'att-1')).resolves.toEqual(resolved);
			await expect(service.resolveAttachmentFile(user, 'att-1')).resolves.toEqual(resolved);
			await service.resolveAttachmentFile({ id: 'user-2' } as any, 'att-1');

			expect(uncached).toHaveBeenCalledTimes(2);
			expect(uncached).toHaveBeenNthCalledWith(1, user, 'att-1');
		});

		it('re-resolves when the cached file disappeared from disk', async () => {
			const { service } = createService();
			const uncached = jest
				.spyOn(service as any, 'resolveAttachmentFileUncached')
				.mockResolvedValueOnce({ ...resolved, absolutePath: `${__filename}.missing` })
				.mockResolvedValueOnce(resolved);
			const user = { id: 'user-1' } as any;

			await service.resolveAttachmentFile(user, 'att-1');
			await expect(service.resolveAttachmentFile(user, 'att-1')).resolves.toEqual(resolved);

			expect(uncached).toHaveBeenCalledTimes(2);
		});

		it('does not cache failed resolutions', async () => {
			const { service } = createService();
			const uncached = jest
				.spyOn(service as any, 'resolveAttachmentFileUncached')
				.mockRejectedValueOnce(new Error('WhatsApp media is not available'))
				.mockResolvedValueOnce(resolved);
			const user = { id: 'user-1' } as any;

			await expect(service.resolveAttachmentFile(user, 'att-1')).rejects.toThrow(/not available/);
			await expect(service.resolveAttachmentFile(user, 'att-1')).resolves.toEqual(resolved);
			expect(uncached).toHaveBeenCalledTimes(2);
		});
	});

	describe('storeDownloadedMedia streamed downloads (audit A7)', () => {
		const mp4Header = Buffer.concat([
			Buffer.from([0, 0, 0, 0x18]),
			Buffer.from('ftypmp42'),
			Buffer.alloc(4096, 7),
		]);
		const jpegHeader = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 1)]);
		let dir: string;

		beforeEach(async () => {
			dir = await mkdtemp(join(tmpdir(), 'wa-store-'));
		});
		afterEach(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		it('validates a streamed video from its header and moves it into place', async () => {
			const { service } = createService();
			const part = join(dir, 'att-1-clip.mp4.part');
			const target = join(dir, 'att-1-clip.mp4');
			await writeFile(part, mp4Header);
			const attachment: any = { type: 'video', mimeType: null, fileName: 'clip.mp4' };

			const size = await (service as any).storeDownloadedMedia(
				attachment,
				{ filePath: part },
				null,
				target,
			);

			expect(size).toBe(mp4Header.length);
			expect(attachment.mimeType).toBe('video/mp4');
			expect((await stat(target)).size).toBe(mp4Header.length);
			await expect(stat(part)).rejects.toThrow();
		});

		it('rejects a streamed thumbnail posing as video without moving it', async () => {
			const { service } = createService();
			const part = join(dir, 'att-2-clip.mp4.part');
			const target = join(dir, 'att-2-clip.mp4');
			await writeFile(part, jpegHeader);

			await expect(
				(service as any).storeDownloadedMedia(
					{ type: 'video', mimeType: 'video/mp4', fileName: 'clip.mp4' },
					{ filePath: part },
					null,
					target,
				),
			).rejects.toThrow(/thumbnail instead of video/);
			await expect(stat(target)).rejects.toThrow();
		});

		it('keeps the buffer path for providers that cannot stream', async () => {
			const { service } = createService();
			const target = join(dir, 'att-3-photo.jpg');
			const attachment: any = { type: 'image', mimeType: null, fileName: 'photo.jpg' };

			const size = await (service as any).storeDownloadedMedia(
				attachment,
				{ data: jpegHeader },
				null,
				target,
			);

			expect(size).toBe(jpegHeader.length);
			expect(attachment.mimeType).toBe('image/jpeg');
			expect((await readFile(target)).equals(jpegHeader)).toBe(true);
		});
	});
});
