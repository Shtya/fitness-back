import { normalizePhoneKey } from './whatsapp-phone-key';

describe('normalizePhoneKey', () => {
	it('puts local and international forms of one number in one bucket', () => {
		expect(normalizePhoneKey('01001234567')).toBe('201001234567');
		expect(normalizePhoneKey('00201001234567')).toBe('201001234567');
		expect(normalizePhoneKey('+20 100 123 4567')).toBe('201001234567');
	});
	it("uses the linked account's country for national numbers", () => {
		expect(normalizePhoneKey('0501234567', '966551112222')).toBe('966501234567');
	});
	it('rejects things that are not phone numbers', () => {
		expect(normalizePhoneKey('123')).toBe('');
		expect(normalizePhoneKey('')).toBe('');
	});
});
