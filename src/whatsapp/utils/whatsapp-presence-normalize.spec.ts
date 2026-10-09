import {
	mapBaileysLastKnownPresence,
	normalizeBaileysPresenceUpdate,
} from './whatsapp-presence-normalize';

describe('whatsapp presence normalize', () => {
	it('maps Baileys lastKnownPresence values used by chats.js', () => {
		expect(mapBaileysLastKnownPresence('available')).toBe('available');
		expect(mapBaileysLastKnownPresence('paused')).toBe('available');
		expect(mapBaileysLastKnownPresence('composing')).toBe('composing');
		expect(mapBaileysLastKnownPresence('recording')).toBe('recording');
		expect(mapBaileysLastKnownPresence('unavailable')).toBe('unavailable');
		expect(mapBaileysLastKnownPresence('')).toBeNull();
		expect(mapBaileysLastKnownPresence('mystery')).toBeNull();
	});

	it('prefers phone @c.us when presence arrives on a LID', () => {
		const result = normalizeBaileysPresenceUpdate(
			{
				id: '123456789012345@lid',
				presences: {
					'123456789012345@lid': {
						lastKnownPresence: 'available',
						lastSeen: 1_700_000_000,
					},
				},
			},
			(jid) => (jid.includes('@lid') ? '201551495772' : null),
		);
		expect(result).toMatchObject({
			chatId: '201551495772@c.us',
			chatIdRaw: '123456789012345@lid',
			phoneDigits: '201551495772',
			state: 'available',
			isOnline: true,
			lastSeen: 1_700_000_000_000,
		});
		expect(result?.chatIdAliases).toEqual(
			expect.arrayContaining([
				'123456789012345@lid',
				'201551495772@c.us',
				'201551495772@s.whatsapp.net',
			]),
		);
	});

	it('keeps typing separate from unavailable and records privacy deny', () => {
		const typing = normalizeBaileysPresenceUpdate({
			id: '201000000000@s.whatsapp.net',
			presences: {
				'201000000000@s.whatsapp.net': { lastKnownPresence: 'composing' },
			},
		});
		expect(typing).toMatchObject({
			chatId: '201000000000@c.us',
			state: 'composing',
			isOnline: true,
			typing: true,
			recording: false,
		});

		const denied = normalizeBaileysPresenceUpdate({
			id: '201000000000@c.us',
			presences: {
				'201000000000@c.us': {
					lastKnownPresence: 'unavailable',
					lastSeen: 'deny',
				},
			},
		});
		expect(denied).toMatchObject({
			state: 'unavailable',
			isOnline: false,
			lastSeen: 0,
			lastSeenRestricted: true,
		});
	});

	it('ignores empty subscribe acknowledgements without inventing offline', () => {
		expect(
			normalizeBaileysPresenceUpdate({
				id: '201000000000@c.us',
				presences: { '201000000000@c.us': {} },
			}),
		).toBeNull();
	});
});
