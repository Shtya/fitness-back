import { ContactPhoneError, describeStoredPhone, normalizeContactPhone } from './whatsapp-contact-phone';

function codeOf(fn: () => unknown) {
	try {
		fn();
	} catch (error) {
		return error instanceof ContactPhoneError ? error.code : 'OTHER';
	}
	return null;
}

describe('normalizeContactPhone', () => {
	it('gives every spelling of the same number one canonical form', () => {
		const forms = ['+20 100 123 4567', '0020 100-123-4567', '+20(100)1234567', '\u200e+201001234567'];
		for (const form of forms) {
			expect(normalizeContactPhone(form)).toMatchObject({
				digits: '201001234567',
				e164: '+201001234567',
				country: 'EG',
			});
		}
	});

	it('reads Arabic-Indic and Persian digits', () => {
		expect(normalizeContactPhone('+٢٠١٠٠١٢٣٤٥٦٧').digits).toBe('201001234567');
		expect(normalizeContactPhone('+۲۰۱۰۰۱۲۳۴۵۶۷').digits).toBe('201001234567');
	});

	it('uses the chosen country, then the account country, for local numbers', () => {
		expect(normalizeContactPhone('01001234567', { defaultCountry: 'eg' }).digits).toBe('201001234567');
		expect(normalizeContactPhone('5550 0101', { accountPhone: '97455500000' }).digits).toBe('97455500101');
	});

	it('refuses to guess a country', () => {
		expect(codeOf(() => normalizeContactPhone('01001234567'))).toBe('PHONE_NEEDS_COUNTRY_CODE');
	});

	it('rejects empty, malformed and impossible numbers', () => {
		expect(codeOf(() => normalizeContactPhone('   '))).toBe('PHONE_REQUIRED');
		expect(codeOf(() => normalizeContactPhone('+20 abc 123'))).toBe('PHONE_INVALID');
		expect(codeOf(() => normalizeContactPhone('+20 12'))).toBe('PHONE_INVALID');
		expect(codeOf(() => normalizeContactPhone('+999 1234567'))).toBe('PHONE_INVALID');
	});
});

describe('describeStoredPhone', () => {
	it('formats stored digits without throwing', () => {
		expect(describeStoredPhone('201001234567')?.international).toBe('+20 10 01234567');
		expect(describeStoredPhone('')).toBeNull();
		expect(describeStoredPhone('123')?.digits).toBe('123');
	});
});
