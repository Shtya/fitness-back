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

	it('reports which group member is typing (phone jid)', () => {
		const result = normalizeBaileysPresenceUpdate({
			id: '120363000000000001@g.us',
			presences: { '201000000001@s.whatsapp.net': { lastKnownPresence: 'composing' } },
		});
		expect(result).toMatchObject({
			chatId: '120363000000000001@g.us',
			state: 'composing',
			typing: true,
			participantJid: '201000000001@s.whatsapp.net',
			participantPhoneDigits: '201000000001',
		});
		expect(result?.participantAliases).toEqual(
			expect.arrayContaining(['201000000001@s.whatsapp.net', '201000000001@c.us']),
		);
	});

	it('resolves a LID group member to a phone and prefers the active member', () => {
		const result = normalizeBaileysPresenceUpdate(
			{
				id: '120363000000000001@g.us',
				presences: {
					'111111111111111@lid': { lastKnownPresence: 'paused' },
					'222222222222222:3@lid': { lastKnownPresence: 'recording' },
				},
			},
			(jid) => (jid === '222222222222222@lid' ? '201000000002' : null),
		);
		expect(result).toMatchObject({
			state: 'recording',
			recording: true,
			participantJid: '222222222222222:3@lid',
			participantPhoneDigits: '201000000002',
		});
		expect(result?.participantAliases).toEqual(
			expect.arrayContaining(['222222222222222@lid', '201000000002@c.us']),
		);
	});

	it('leaves participant empty for direct chats', () => {
		const result = normalizeBaileysPresenceUpdate({
			id: '201000000000@c.us',
			presences: { '201000000000@c.us': { lastKnownPresence: 'composing' } },
		});
		expect(result?.participantJid).toBeNull();
		expect(result?.participantAliases).toEqual([]);
	});
});
