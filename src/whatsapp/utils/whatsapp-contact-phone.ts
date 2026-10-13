import { CountryCode, isSupportedCountry, parsePhoneNumberFromString } from 'libphonenumber-js';

export type ContactPhoneErrorCode =
	| 'PHONE_REQUIRED'
	| 'PHONE_NEEDS_COUNTRY_CODE'
	| 'PHONE_INVALID';

export class ContactPhoneError extends Error {
	constructor(
		readonly code: ContactPhoneErrorCode,
		message: string,
	) {
		super(message);
	}
}

export interface ContactPhone {
	/** Country code + national number, digits only (the WhatsApp user part). */
	digits: string;
	e164: string;
	international: string;
	national: string;
	country: string | null;
}

function countryOf(value?: string | null): CountryCode | undefined {
	const code = String(value || '').trim().toUpperCase();
	return code && isSupportedCountry(code) ? (code as CountryCode) : undefined;
}

/** Country of the linked account's own number, used when the user types a local number. */
export function countryFromPhone(phone?: string | null): CountryCode | undefined {
	const digits = String(phone || '').replace(/\D/g, '');
	if (!digits) return undefined;
	return parsePhoneNumberFromString(`+${digits}`)?.country || undefined;
}

/**
 * Strict international normalization. A number without `+`/`00` is read as local to
 * `defaultCountry`, then to the account's own country; with neither it is rejected
 * instead of guessed.
 */
export function normalizeContactPhone(
	raw: string,
	options: { defaultCountry?: string | null; accountPhone?: string | null } = {},
): ContactPhone {
	const input = String(raw || '')
		.trim()
		.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
		.replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
	if (!input) throw new ContactPhoneError('PHONE_REQUIRED', 'Enter a phone number');
	if (/[^\d+\s\-().\u200e\u200f]/.test(input)) {
		throw new ContactPhoneError('PHONE_INVALID', 'Phone numbers can only contain digits');
	}
	const compact = input.replace(/[\s\-().\u200e\u200f]/g, '');
	const international = compact.startsWith('+')
		? compact
		: compact.startsWith('00')
			? `+${compact.slice(2)}`
			: null;
	const country = international
		? undefined
		: countryOf(options.defaultCountry) || countryFromPhone(options.accountPhone);
	if (!international && !country) {
		throw new ContactPhoneError(
			'PHONE_NEEDS_COUNTRY_CODE',
			'Include the country code, for example +20 100 123 4567',
		);
	}
	const parsed = parsePhoneNumberFromString(international || compact, country);
	if (!parsed || !parsed.isValid()) {
		throw new ContactPhoneError('PHONE_INVALID', 'This is not a valid phone number');
	}
	const e164 = parsed.format('E.164');
	return {
		digits: e164.slice(1),
		e164,
		international: parsed.formatInternational(),
		national: parsed.formatNational(),
		country: parsed.country || null,
	};
}

/** Display form of digits already stored; never throws. */
export function describeStoredPhone(value?: string | null): ContactPhone | null {
	const digits = String(value || '').replace(/\D/g, '');
	if (!digits) return null;
	const parsed = parsePhoneNumberFromString(`+${digits}`);
	if (!parsed) {
		return { digits, e164: `+${digits}`, international: `+${digits}`, national: digits, country: null };
	}
	return {
		digits,
		e164: parsed.format('E.164'),
		international: parsed.formatInternational(),
		national: parsed.formatNational(),
		country: parsed.country || null,
	};
}
