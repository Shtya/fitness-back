import {
	enrichContactMessageNormalized,
	extractSharedContactFromRaw,
	formatPhoneForDisplay,
	isContactMessageType,
	mergeContactIntoPersistableRaw,
	needsContactHydration,
	parseVcardPhones,
	statusAudienceJids,
} from './whatsapp-contact';

describe('statusAudienceJids', () => {
	it('accepts contact jids, chat ids and bare numbers, deduplicated', () => {
		expect(
			statusAudienceJids([
				'201234567890@s.whatsapp.net',
				'201234567890@c.us',
				'+20 100 111 2233',
				'201234567890',
			]),
		).toEqual(['201234567890@s.whatsapp.net', '201001112233@s.whatsapp.net']);
	});

	it('drops everything that cannot view a status', () => {
		expect(
			statusAudienceJids([
				'120363111222333444@g.us',
				'status@broadcast',
				'1234@broadcast',
				'98765432101234@lid',
				'0123456789@newsletter',
				'',
				null,
				undefined,
			]),
		).toEqual([]);
	});

	it('rejects numbers that are not dialable', () => {
		expect(statusAudienceJids(['123', '1234567', '1234567890123456789'])).toEqual([]);
		expect(statusAudienceJids(['12345678'])).toEqual(['12345678@s.whatsapp.net']);
	});
});

describe('whatsapp-contact', () => {
	it('detects contact message types', () => {
		expect(isContactMessageType('vcard')).toBe(true);
		expect(isContactMessageType('multi_vcard')).toBe(true);
		expect(isContactMessageType('text')).toBe(false);
	});

	it('parses vCard phones with waid and display number', () => {
		const vcard = [
			'BEGIN:VCARD',
			'VERSION:3.0',
			'FN:خالو 😍',
			'TEL;type=CELL;waid=201090998111:+20 10 9099 8111',
			'END:VCARD',
		].join('\n');
		const phones = parseVcardPhones(vcard);
		expect(phones).toHaveLength(1);
		expect(phones[0].waId).toBe('201090998111@c.us');
		expect(phones[0].formatted).toBe('+20 10 9099 8111');
	});

	it('extracts WPPConnect vcard payload', () => {
		const shared = extractSharedContactFromRaw({
			type: 'vcard',
			body: 'خالو 😍',
			vcardFormattedName: 'خالو 😍',
			vcard: [
				'BEGIN:VCARD',
				'VERSION:3.0',
				'FN:خالو 😍',
				'TEL;type=CELL;waid=201090998111:+20 10 9099 8111',
				'END:VCARD',
			].join('\n'),
		});
		expect(shared?.displayName).toBe('خالو 😍');
		expect(shared?.phones[0]?.formatted).toBe('+20 10 9099 8111');
		expect(shared?.waId).toBe('201090998111@c.us');
	});

	it('enriches normalized contact messages', () => {
		const enriched = enrichContactMessageNormalized({
			type: 'vcard',
			text: '201090998111@c.us',
			raw: {
				vcardFormattedName: 'خالو 😍',
				vcard: 'BEGIN:VCARD\nFN:خالو 😍\nTEL;type=CELL;waid=201090998111:+20 10 9099 8111\nEND:VCARD',
			},
		});
		expect(enriched.type).toBe('contact');
		expect(enriched.text).toBe('خالو 😍');
		expect((enriched.raw as any).sharedContact.displayName).toBe('خالو 😍');
	});

	it('formats phone numbers for display', () => {
		expect(formatPhoneForDisplay('', '201090998111@c.us')).toBe('+201090998111');
		expect(formatPhoneForDisplay('+20 10 9099 8111')).toBe('+20 10 9099 8111');
	});

	it('enriches contact payload even when type is text', () => {
		const enriched = enrichContactMessageNormalized({
			type: 'text',
			text: 'خالو 😍',
			raw: {
				type: 'chat',
				body: 'خالو 😍',
				vcardFormattedName: 'خالو 😍',
				vcard: 'BEGIN:VCARD\nFN:خالو 😍\nTEL;type=CELL;waid=201090998111:+20 10 9099 8111\nEND:VCARD',
			},
		});
		expect(enriched.type).toBe('contact');
		expect(enriched.text).toBe('خالو 😍');
		expect((enriched.raw as any).sharedContact.phones[0].formatted).toBe('+20 10 9099 8111');
	});

	it('ignores plain chat text without vcard payload', () => {
		expect(
			extractSharedContactFromRaw({
				type: 'chat',
				body: 'على تلاته كده تاكل ولا ايه',
			}),
		).toBeNull();
	});

	it('persists shared contact fields into stored raw', () => {
		const persisted = mergeContactIntoPersistableRaw(null, {
			type: 'vcard',
			text: 'خالو 😍',
			raw: {
				vcardFormattedName: 'خالو 😍',
				vcard: 'BEGIN:VCARD\nFN:خالو 😍\nTEL;type=CELL;waid=201090998111:+20 10 9099 8111\nEND:VCARD',
			},
		});
		expect(persisted?.sharedContact?.displayName).toBe('خالو 😍');
		expect(persisted?.vcard).toContain('BEGIN:VCARD');
		expect(persisted?.sharedContact?.phones[0]?.formatted).toBe('+20 10 9099 8111');
	});

	it('flags contact messages that still need provider hydration', () => {
		expect(
			needsContactHydration({
				type: 'contact',
				text: 'خالو 😍',
				raw: { body: 'خالو 😍' },
			}),
		).toBe(true);
		expect(
			needsContactHydration({
				type: 'contact',
				text: 'خالو 😍',
				raw: {
					sharedContact: {
						displayName: 'خالو 😍',
						phones: [{ formatted: '+20 10 9099 8111', phone: '+20 10 9099 8111' }],
					},
				},
			}),
		).toBe(false);
	});
});
