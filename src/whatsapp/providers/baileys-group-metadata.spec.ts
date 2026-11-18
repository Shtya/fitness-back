import { BaileysProvider } from './baileys.provider';

const GROUP = '120363000000000001@g.us';
const META = { id: GROUP, subject: 'MADAR', participants: [{ id: '201000000001@s.whatsapp.net' }] };

function provider(groupMetadata: jest.Mock) {
	const p = new BaileysProvider('account-group-meta') as any;
	p.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	p.state = 'connected';
	p.socket = { groupMetadata };
	return p;
}

describe('group members for sending (cachedGroupMetadata)', () => {
	it('asks WhatsApp once and serves the cache after that', async () => {
		const groupMetadata = jest.fn(async () => META);
		const p = provider(groupMetadata);
		expect(await p.getCachedGroupMetadata(GROUP)).toEqual(META);
		expect(await p.getCachedGroupMetadata(GROUP)).toEqual(META);
		expect(groupMetadata).toHaveBeenCalledTimes(1);
	});

	it('sends with the last known members when the refresh is refused (rate-overlimit)', async () => {
		const groupMetadata = jest.fn(async () => META);
		const p = provider(groupMetadata);
		await p.getCachedGroupMetadata(GROUP);
		p.groupMetadataCache.del(GROUP); // expired, or cleared by a group update
		groupMetadata.mockRejectedValueOnce(new Error('rate-overlimit'));
		expect(await p.getCachedGroupMetadata(GROUP)).toEqual(META);
		expect(p.logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate-overlimit'));
	});

	it('returns nothing for a group it never saw when WhatsApp refuses', async () => {
		const p = provider(jest.fn(async () => Promise.reject(new Error('timed out'))));
		expect(await p.getCachedGroupMetadata(GROUP)).toBeUndefined();
	});
});
