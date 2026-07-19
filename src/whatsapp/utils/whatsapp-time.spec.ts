import { whatsAppTimestampToDate, whatsAppTimestampToMs } from './whatsapp-time';

describe('WhatsApp timestamp normalization', () => {
	it('normalizes unix seconds and milliseconds to the same value', () => {
		expect(whatsAppTimestampToMs(1_700_000_000)).toBe(1_700_000_000_000);
		expect(whatsAppTimestampToMs(1_700_000_000_000)).toBe(1_700_000_000_000);
	});

	it.each([null, undefined, '', 0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects invalid timestamp %p',
		value => {
			expect(whatsAppTimestampToMs(value)).toBeNull();
		},
	);

	it('rejects pre-WhatsApp and far-future dates', () => {
		expect(whatsAppTimestampToDate(Date.UTC(2008, 0, 1))).toBeNull();
		expect(whatsAppTimestampToDate(Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
	});

	it('accepts a valid Date instance', () => {
		const value = new Date('2025-01-01T00:00:00.000Z');
		expect(whatsAppTimestampToDate(value)?.toISOString()).toBe(value.toISOString());
	});
});
