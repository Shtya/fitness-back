import { BaileysProvider, pickLinkBrowser, shouldSyncFullHistory } from './baileys.provider';

const Browsers = {
	ubuntu: (name: string) => ['Ubuntu', name, '22.04.4'],
	macOS: (name: string) => ['Mac OS', name, '14.4.1'],
};

describe('full history at link time', () => {
	const original = process.env.WHATSAPP_SYNC_FULL_HISTORY;
	afterEach(() => {
		if (original === undefined) delete process.env.WHATSAPP_SYNC_FULL_HISTORY;
		else process.env.WHATSAPP_SYNC_FULL_HISTORY = original;
	});

	it('is on unless switched off', () => {
		delete process.env.WHATSAPP_SYNC_FULL_HISTORY;
		expect(shouldSyncFullHistory()).toBe(true);
		process.env.WHATSAPP_SYNC_FULL_HISTORY = 'false';
		expect(shouldSyncFullHistory()).toBe(false);
		process.env.WHATSAPP_SYNC_FULL_HISTORY = '1';
		expect(shouldSyncFullHistory()).toBe(true);
	});

	it('links a new device as WhatsApp Desktop, so WhatsApp sends the full archive', () => {
		expect(pickLinkBrowser(Browsers, { paired: false, fullHistory: true })).toEqual(['Mac OS', 'Desktop', '14.4.1']);
	});

	it('keeps an already linked device as it was linked', () => {
		expect(pickLinkBrowser(Browsers, { paired: true, fullHistory: true })).toEqual(['Ubuntu', 'Chrome', '22.04.4']);
		expect(pickLinkBrowser(Browsers, { paired: false, fullHistory: false })).toEqual(['Ubuntu', 'Chrome', '22.04.4']);
	});
});

describe('opening a chat we hold no message of', () => {
	// The request waits for the phone in real time (~1s here); the full parallel run is slow.
	jest.setTimeout(30_000);
	function provider(fetchMessageHistory: jest.Mock) {
		const p = new BaileysProvider('account-empty-chat') as any;
		p.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
		p.state = 'connected';
		p.socket = { user: { id: '201000000000:5@s.whatsapp.net' }, fetchMessageHistory };
		p.phoneRequests = { run: async (_kind: string, _key: string, work: () => Promise<boolean>) => ((await work()) ? 'ok' : 'no_response') };
		return p;
	}

	it('asks the phone for the newest messages, anchored at now', async () => {
		const fetch = jest.fn(async function (this: any) {
			return undefined;
		});
		const p = provider(fetch);
		fetch.mockImplementation(async () => {
			p.historySyncChunks += 1;
		});
		const before = Date.now();
		await p.getMessages('201011112222@c.us', { limit: 30 });
			await Promise.all([...p.emptyChatRequests.values()]);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [count, key, timestampMs] = fetch.mock.calls[0] as unknown as [number, any, number];
		expect(count).toBe(30);
		expect(key).toEqual(expect.objectContaining({ remoteJid: '201011112222@s.whatsapp.net', fromMe: false }));
		expect(typeof key.id).toBe('string');
		expect(timestampMs).toBeGreaterThanOrEqual(before);
		expect(p.logger.log).toHaveBeenCalledWith(expect.stringContaining('outcome=ok'));
	});

	it('asks at most once per chat in 30 minutes', async () => {
		const fetch = jest.fn(async () => undefined);
		const p = provider(fetch);
		jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
			fn();
			return 0 as any;
		}) as any);
		try {
			await p.getMessages('201011112222@c.us', { limit: 30 });
			await Promise.all([...p.emptyChatRequests.values()]);
			await p.getMessages('201011112222@c.us', { limit: 30 });
			await Promise.all([...p.emptyChatRequests.values()]);
		} finally {
			(global.setTimeout as any).mockRestore?.();
		}
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('asks again under the LID when the phone does not answer for the phone number', async () => {
		const fetch = jest.fn(async () => undefined);
		const p = provider(fetch);
		p.socket.signalRepository = { lidMapping: { getLIDForPN: jest.fn(async () => '128050339573779:0@lid') } };
		jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
			fn();
			return 0 as any;
		}) as any);
		try {
			await p.getMessages('201011112222@c.us', { limit: 30 });
			await Promise.all([...p.emptyChatRequests.values()]);
		} finally {
			(global.setTimeout as any).mockRestore?.();
		}
		const asked = (fetch.mock.calls as unknown as Array<[number, any, number]>).map(call => call[1].remoteJid);
		expect(asked).toEqual(['201011112222@s.whatsapp.net', '128050339573779@lid']);
	});

	it('opens the chat at once instead of waiting on the phone', async () => {
		const fetch = jest.fn(async () => undefined); // the phone never answers
		const p = provider(fetch);
		const started = Date.now();
		const list = await p.getMessages('201033334444@c.us', { limit: 30 });
		expect(list).toEqual([]);
		expect(Date.now() - started).toBeLessThan(500);
		expect(p.emptyChatRequests.size).toBe(1);
	});

	it('does not ask when there are messages or when paging back', async () => {
		const fetch = jest.fn(async () => undefined);
		const p = provider(fetch);
		await p.getMessages('201011112222@c.us', { limit: 30, before: 'SOME-ID' });
		expect(fetch).not.toHaveBeenCalled();
	});
});
