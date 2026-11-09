import { dedupeStatusRows, isOwnStatusSender, ownStatusUsers, statusSenderUser } from './whatsapp-status-owner';

describe('story owner', () => {
	const own = ownStatusUsers(['201011112222@s.whatsapp.net', '99887766554433@lid'], '+20 101 111 2222');

	it('reads the user part of any JID spelling', () => {
		expect(statusSenderUser('99887766554433:12@lid')).toBe('99887766554433');
		expect(statusSenderUser('201011112222@c.us')).toBe('201011112222');
		expect(statusSenderUser('')).toBe('');
	});

	it('recognises our stories by phone JID, LID (any device) or the account number', () => {
		expect(isOwnStatusSender('99887766554433@lid', own)).toBe(true);
		expect(isOwnStatusSender('99887766554433:3@lid', own)).toBe(true);
		expect(isOwnStatusSender('201011112222@c.us', own)).toBe(true);
		expect(isOwnStatusSender('201555555555@s.whatsapp.net', own)).toBe(false);
		expect(isOwnStatusSender(null, own)).toBe(false);
		// with no live session, the account number still catches phone-JID stories
		expect(isOwnStatusSender('201011112222@s.whatsapp.net', ownStatusUsers([], '201011112222'))).toBe(true);
	});

	it('keeps one row per story, ours and the downloaded one first', () => {
		const rows = [
			{ id: 'a', providerStatusId: 'false_status@broadcast_3EB0AAA_99887766554433@lid', isOwn: false, mediaPath: null },
			{ id: 'b', providerStatusId: 'true_status@broadcast_3EB0AAA_99887766554433@lid', isOwn: true, mediaPath: null },
			{ id: 'c', providerStatusId: 'false_status@broadcast_3EB0BBB_5555@lid', isOwn: false, mediaPath: null },
			{ id: 'd', providerStatusId: 'false_status@broadcast_3EB0BBB_201555@c.us', isOwn: false, mediaPath: '/m/bbb.jpg' },
			{ id: 'e', providerStatusId: 'false_status@broadcast_3EB0CCC_201666@c.us', isOwn: false, mediaPath: null },
		];
		const { kept, dropped } = dedupeStatusRows(rows);
		expect(kept.map(row => row.id)).toEqual(['b', 'd', 'e']);
		expect(dropped.map(row => row.id).sort()).toEqual(['a', 'c']);
	});
});
