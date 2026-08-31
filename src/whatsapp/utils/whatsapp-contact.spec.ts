import {
	enrichContactMessageNormalized,
	extractSharedContactFromRaw,
	formatPhoneForDisplay,
	isContactMessageType,
	parseVcardPhones,
} from './whatsapp-contact';

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

	it('ignores plain chat text without vcard payload', () => {
		expect(
			extractSharedContactFromRaw({
				type: 'chat',
				body: 'على تلاته كده تاكل ولا ايه',
			}),
		).toBeNull();
	});
});
