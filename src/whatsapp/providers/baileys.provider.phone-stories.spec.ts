import { BaileysProvider } from './baileys.provider';
import { storyAnchorFromRow } from '../services/whatsapp-status.service';

const nowSec = () => Math.floor(Date.now() / 1000);

function story(id: string, minutesAgo: number, participant = '201000000001@s.whatsapp.net') {
	return {
		key: { remoteJid: 'status@broadcast', id, fromMe: false, participant },
		messageTimestamp: nowSec() - minutesAgo * 60,
		message: { imageMessage: { mimetype: 'image/jpeg' } },
	};
}

/** A phone that answers each history request with the stories older than the anchor. */
function phoneWith(stories: any[], provider: any, pageSize = 2) {
	return jest.fn(async (_count: number, key: any, timestamp: number) => {
		// Proto field is ms; messageTimestamp on stories is seconds (same as production WA).
		const tsSec = Number(timestamp) > 1e12 ? Math.floor(Number(timestamp) / 1000) : Number(timestamp);
		const older = stories
			.filter(s => Number(s.messageTimestamp) < tsSec && s.key.id !== key.id)
			.sort((a, b) => b.messageTimestamp - a.messageTimestamp)
			.slice(0, pageSize);
		// what Baileys does with an ON_DEMAND history chunk
		setTimeout(() => (provider as any).ingestHistoryRawMessages(older), 50);
	});
}

function connectedProvider() {
	const provider = new BaileysProvider('account-phone-stories') as any;
	provider.state = 'connected';
	provider.socket = { user: { id: '201099999999:1@s.whatsapp.net' } };
	return provider;
}

describe('asking the phone for its current stories', () => {
	it('starts from the newest story in the database when the cache is empty, and pages back', async () => {
		const provider = connectedProvider();
		const onPhone = [story('S1', 10), story('S2', 60), story('S3', 120), story('S4', 300), story('S5', 600)];
		provider.socket.fetchMessageHistory = phoneWith(onPhone, provider);
		const events: any[] = [];
		provider.onEvent((event: any) => events.push(event));

		const result = await provider.requestStatusesFromPhone(
			[{ id: 'S1', participant: '201000000001@s.whatsapp.net', fromMe: false, timestamp: Number(onPhone[0].messageTimestamp) }],
			{ waitMs: 1500 },
		);

		expect(result).toMatchObject({ requested: true, before: 0 });
		// S1 itself came from the database; the phone sent S2..S5 over the pages
		const ids = (await provider.getStatuses()).map((s: any) => s.messageId).sort();
		expect(ids).toEqual(['S2', 'S3', 'S4', 'S5']);
		const firstCall = provider.socket.fetchMessageHistory.mock.calls[0];
		expect(firstCall[1]).toMatchObject({ remoteJid: 'status@broadcast', id: 'S1', participant: '201000000001@s.whatsapp.net' });
		// Proto field is milliseconds; message timestamps are seconds.
		expect(firstCall[2]).toBe(Number(onPhone[0].messageTimestamp) * 1000);
		expect(provider.socket.fetchMessageHistory.mock.calls.length).toBeGreaterThan(1);
		await new Promise(r => setTimeout(r, 900));
		expect(events.some(event => event.type === 'status_changed')).toBe(true);
	}, 30_000);

	it('stops when the phone sends nothing new', async () => {
		const provider = connectedProvider();
		provider.socket.fetchMessageHistory = jest.fn(async () => undefined);
		const result = await provider.requestStatusesFromPhone(
			[{ id: 'S1', fromMe: false, timestamp: nowSec() - 60 }],
			{ waitMs: 600 },
		);
		expect(result).toMatchObject({ requested: true, pages: 1, before: 0, after: 0 });
		expect(provider.socket.fetchMessageHistory).toHaveBeenCalledTimes(1);
	});

	it('says why it did not ask', async () => {
		const offline = new BaileysProvider('account-offline') as any;
		await expect(offline.requestStatusesFromPhone([])).resolves.toMatchObject({ requested: false, reason: 'not_connected' });
		const noAnchor = connectedProvider();
		noAnchor.socket.fetchMessageHistory = jest.fn();
		await expect(noAnchor.requestStatusesFromPhone([], { waitMs: 0 })).resolves.toMatchObject({
			requested: false,
			reason: 'no_anchor',
		});
		expect(noAnchor.socket.fetchMessageHistory).not.toHaveBeenCalled();
	});
});

describe('story anchors from stored rows', () => {
	it('reads the message id, poster and side from the stored id', () => {
		const at = new Date('2026-11-12T10:00:00Z');
		expect(storyAnchorFromRow({ providerStatusId: 'false_status@broadcast_3EB0ABC_201000000001@s.whatsapp.net', publishedAt: at })).toEqual({
			id: '3EB0ABC',
			fromMe: false,
			participant: '201000000001@s.whatsapp.net',
			timestamp: Math.floor(at.getTime() / 1000),
		});
		expect(storyAnchorFromRow({ providerStatusId: 'true_status@broadcast_3EB0MINE', publishedAt: at })).toMatchObject({
			id: '3EB0MINE',
			fromMe: true,
			participant: null,
		});
		expect(storyAnchorFromRow({ providerStatusId: 'status-1', publishedAt: at })).toBeNull();
	});
});
