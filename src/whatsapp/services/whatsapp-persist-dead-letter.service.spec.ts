import {
	DEAD_LETTER_KEY,
	DEAD_LETTER_PARKED_KEY,
	WhatsAppPersistDeadLetterService,
	parseDeadLetter,
	serializeDeadLetter,
} from './whatsapp-persist-dead-letter.service';

function fakeRedis(ready = true) {
	const lists = new Map<string, string[]>();
	const client = {
		rPush: jest.fn(async (key: string, value: string) => {
			lists.set(key, [...(lists.get(key) || []), value]);
		}),
		lTrim: jest.fn(async () => undefined),
		lLen: jest.fn(async (key: string) => (lists.get(key) || []).length),
		lPopCount: jest.fn(async (key: string, count: number) => {
			const list = lists.get(key) || [];
			const taken = list.splice(0, count);
			return taken.length ? taken : null;
		}),
	};
	const redis = { isReady: jest.fn(() => ready), getClient: jest.fn(() => client) };
	return { redis, client, lists };
}

function message(id = 'wamid-1') {
	return {
		providerMessageId: id,
		chatId: '201000000000@c.us',
		fromMe: false,
		type: 'image',
		timestamp: new Date('2026-09-28T10:00:00.000Z'),
		raw: { message: { imageMessage: { mediaKey: new Uint8Array([1, 2, 250]) } } },
	} as any;
}

describe('WhatsAppPersistDeadLetterService', () => {
	it('round-trips Uint8Array media keys and the timestamp Date', () => {
		const raw = serializeDeadLetter({
			accountId: 'acc-1',
			message: message(),
			context: 'c',
			attempts: 0,
			failedAt: 'now',
			lastError: 'x',
		});
		const parsed = parseDeadLetter(raw)!;
		expect(parsed.message.timestamp).toBeInstanceOf(Date);
		expect(parsed.message.timestamp.toISOString()).toBe('2026-09-28T10:00:00.000Z');
		const key = parsed.message.raw.message.imageMessage.mediaKey;
		expect(Buffer.isBuffer(key)).toBe(true);
		expect([...key]).toEqual([1, 2, 250]);
	});

	it('rejects malformed entries', () => {
		expect(parseDeadLetter('not json')).toBeNull();
		expect(parseDeadLetter(JSON.stringify({ accountId: 'a' }))).toBeNull();
	});

	it('stores failed messages in Redis and replays them on drain', async () => {
		const { redis, lists } = fakeRedis();
		const service = new WhatsAppPersistDeadLetterService(redis as any);
		const replay = jest.fn().mockResolvedValue(undefined);
		service.start(replay);

		await service.add('acc-1', message(), 'message:acc-1:wamid-1', new Error('db down'));
		expect(lists.get(DEAD_LETTER_KEY)).toHaveLength(1);
		expect(await service.size()).toBe(1);

		const result = await service.drain();
		expect(result).toEqual({ replayed: 1, requeued: 0, parked: 0 });
		expect(replay).toHaveBeenCalledWith(
			expect.objectContaining({
				accountId: 'acc-1',
				message: expect.objectContaining({ providerMessageId: 'wamid-1' }),
			}),
		);
		expect(await service.size()).toBe(0);
		service.onModuleDestroy();
	});

	it('requeues a failed replay with an incremented attempt counter', async () => {
		const { redis, lists } = fakeRedis();
		const service = new WhatsAppPersistDeadLetterService(redis as any);
		service.start(jest.fn().mockRejectedValue(new Error('still down')));
		await service.add('acc-1', message(), 'ctx', new Error('db down'));

		const result = await service.drain();

		expect(result).toEqual({ replayed: 0, requeued: 1, parked: 0 });
		const entry = parseDeadLetter(lists.get(DEAD_LETTER_KEY)![0])!;
		expect(entry.attempts).toBe(1);
		expect(entry.lastError).toBe('still down');
		service.onModuleDestroy();
	});

	it('parks an entry after the max replay attempts instead of dropping it', async () => {
		const { redis, lists } = fakeRedis();
		const service = new WhatsAppPersistDeadLetterService(redis as any);
		service.start(jest.fn().mockRejectedValue(new Error('poison')));
		lists.set(DEAD_LETTER_KEY, [
			serializeDeadLetter({
				accountId: 'acc-1',
				message: message(),
				context: 'ctx',
				attempts: 19,
				failedAt: 'then',
				lastError: 'x',
			}),
		]);

		const result = await service.drain();

		expect(result.parked).toBe(1);
		expect(lists.get(DEAD_LETTER_PARKED_KEY)).toHaveLength(1);
		expect(lists.get(DEAD_LETTER_KEY) || []).toHaveLength(0);
		service.onModuleDestroy();
	});

	it('falls back to memory when Redis is unavailable and still replays', async () => {
		const { redis, client } = fakeRedis(false);
		const service = new WhatsAppPersistDeadLetterService(redis as any);
		const replay = jest.fn().mockResolvedValue(undefined);
		service.start(replay);

		await service.add('acc-1', message(), 'ctx', new Error('db down'));
		expect(client.rPush).not.toHaveBeenCalled();
		expect(await service.size()).toBe(1);

		await service.drain();
		expect(replay).toHaveBeenCalledTimes(1);
		expect(await service.size()).toBe(0);
		service.onModuleDestroy();
	});

	it('does not run two drains at once', async () => {
		const { redis } = fakeRedis();
		const service = new WhatsAppPersistDeadLetterService(redis as any);
		let release: () => void = () => undefined;
		const replay = jest.fn(() => new Promise<void>((resolve) => (release = resolve)));
		service.start(replay);
		await service.add('acc-1', message(), 'ctx', new Error('x'));

		const first = service.drain();
		await new Promise((resolve) => setImmediate(resolve));
		const second = await service.drain();
		release();
		await first;

		expect(second).toEqual({ replayed: 0, requeued: 0, parked: 0 });
		expect(replay).toHaveBeenCalledTimes(1);
		service.onModuleDestroy();
	});
});
