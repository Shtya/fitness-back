import { deflateSync } from 'zlib';
import {
	historyNotificationKey,
	readHistorySync,
	statusMessagesOfHistory,
} from '../utils/whatsapp-status-history';

const STATUS_SYNC = 1;
const ON_DEMAND = 6;
// Stand-in proto: a decoded HistorySync is its JSON.
const proto = {
	HistorySync: {
		HistorySyncType: { INITIAL_STATUS_V3: STATUS_SYNC, ON_DEMAND },
		decode: (bytes: Buffer) => JSON.parse(Buffer.from(bytes).toString('utf8')),
	},
};
const downloadHistory = jest.fn();

jest.mock('./baileys-loader', () => ({
	loadBaileysModule: async () => ({ proto, downloadHistory }),
}));

// eslint-disable-next-line import/first
import { BaileysProvider } from './baileys.provider';

const isStatus = (jid: string) => jid === 'status@broadcast';
const nowSec = () => Math.floor(Date.now() / 1000);

function story(id: string, participant: string, minutesAgo = 30) {
	return {
		key: { remoteJid: 'status@broadcast', id, fromMe: false, participant },
		messageTimestamp: nowSec() - minutesAgo * 60,
		message: { imageMessage: { mimetype: 'image/jpeg' } },
	};
}

describe('stories inside a history sync', () => {
	it('takes statusV3Messages and the status chat, skips other chats, counts each story once', () => {
		const a = story('A', '201000000001@s.whatsapp.net');
		const b = story('B', '201000000002@s.whatsapp.net');
		const out = statusMessagesOfHistory(
			{
				statusV3Messages: [a, a],
				conversations: [
					{ id: 'status@broadcast', messages: [{ message: b }, { message: a }] },
					{ id: '201000000009@s.whatsapp.net', messages: [{ message: { key: { remoteJid: '201000000009@s.whatsapp.net', id: 'X' } } }] },
				],
			},
			isStatus,
		);
		expect(out.map(raw => raw.key.id)).toEqual(['A', 'B']);
	});

	it('reads an inline payload without downloading, and keys notifications stably', async () => {
		const payload = deflateSync(Buffer.from(JSON.stringify({ syncType: STATUS_SYNC, statusV3Messages: [] })));
		const download = jest.fn();
		const sync = await readHistorySync({ initialHistBootstrapInlinePayload: payload }, { proto, downloadHistory: download });
		expect(sync.syncType).toBe(STATUS_SYNC);
		expect(download).not.toHaveBeenCalled();
		const sha = Buffer.from('abc');
		expect(historyNotificationKey({ fileSha256: sha })).toBe(historyNotificationKey({ fileSha256: Buffer.from('abc') }));
		expect(historyNotificationKey(null)).toBe('');
	});
});

describe('BaileysProvider reads the stories the phone sends at link time', () => {
	function connected() {
		const provider = new BaileysProvider('account-status-history') as any;
		provider.state = 'connected';
		provider.socket = { user: { id: '201099999999:1@s.whatsapp.net' } };
		return provider;
	}

	beforeEach(() => downloadHistory.mockReset());

	it('stores every live story from the INITIAL_STATUS_V3 sync (Baileys drops them)', async () => {
		const provider = connected();
		downloadHistory.mockResolvedValue({
			syncType: STATUS_SYNC,
			statusV3Messages: [story('S1', '201000000001@s.whatsapp.net', 300), story('S2', '201000000002@s.whatsapp.net', 20)],
		});
		const events: any[] = [];
		provider.onEvent((event: any) => events.push(event));
		const note = { syncType: STATUS_SYNC, fileSha256: Buffer.from('one'), directPath: '/v/t62/x' };

		await provider.importStatusHistory(note);
		// the same notification again (Baileys retries, reconnects) is not read twice
		await provider.importStatusHistory(note);

		const ids = (await provider.getStatuses()).map((s: any) => s.messageId).sort();
		expect(ids).toEqual(['S1', 'S2']);
		expect(downloadHistory).toHaveBeenCalledTimes(1);
		await new Promise(resolve => setTimeout(resolve, 900));
		expect(events.some(event => event.type === 'status_changed')).toBe(true);
	});

	it('leaves other history alone unless a full resend was asked for', async () => {
		const provider = connected();
		downloadHistory.mockResolvedValue({ syncType: ON_DEMAND, statusV3Messages: [story('S9', '201000000003@s.whatsapp.net')] });

		await provider.importStatusHistory({ syncType: ON_DEMAND, fileSha256: Buffer.from('two') });
		expect(downloadHistory).not.toHaveBeenCalled();

		provider.fullSyncRequestedAt = Date.now();
		await provider.importStatusHistory({ syncType: ON_DEMAND, fileSha256: Buffer.from('two') });
		expect((await provider.getStatuses()).map((s: any) => s.messageId)).toEqual(['S9']);
	});

	it('a failed download can be tried again', async () => {
		const provider = connected();
		downloadHistory.mockRejectedValueOnce(new Error('media gone'));
		downloadHistory.mockResolvedValueOnce({ statusV3Messages: [story('S5', '201000000005@s.whatsapp.net')] });
		const note = { syncType: STATUS_SYNC, fileSha256: Buffer.from('three') };

		await provider.importStatusHistory(note);
		await provider.importStatusHistory(note);
		expect((await provider.getStatuses()).map((s: any) => s.messageId)).toEqual(['S5']);
	});
});
