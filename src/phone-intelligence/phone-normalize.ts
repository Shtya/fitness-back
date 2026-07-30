import { createHash } from 'crypto';
import {
	parsePhoneNumberFromString,
	getCountryCallingCode,
	CountryCode,
} from 'libphonenumber-js';

export interface NormalizedPhone {
	e164: string;
	national: string;
	international: string;
	countryCode: string | null;
	callingCode: string | null;
	countryName: string | null;
	valid: boolean;
	possible: boolean;
	type: string | null;
	phoneHash: string;
	e164Masked: string;
}

const COUNTRY_NAMES: Record<string, string> = {
	EG: 'Egypt',
	SA: 'Saudi Arabia',
	AE: 'United Arab Emirates',
	KW: 'Kuwait',
	QA: 'Qatar',
	BH: 'Bahrain',
	OM: 'Oman',
	JO: 'Jordan',
	LB: 'Lebanon',
	IQ: 'Iraq',
	US: 'United States',
	GB: 'United Kingdom',
	DE: 'Germany',
	FR: 'France',
	TR: 'Turkey',
};

export function hashValue(value: string): string {
	const salt = process.env.PHONE_HASH_SALT || 'so7bafit-phone-salt';
	return createHash('sha256').update(`${salt}:${value}`).digest('hex');
}

export function maskE164(e164: string): string {
	if (!e164 || e164.length < 6) return e164;
	const keepStart = Math.min(4, e164.length - 4);
	const keepEnd = 2;
	const mid = e164.length - keepStart - keepEnd;
	return `${e164.slice(0, keepStart)}${'x'.repeat(Math.max(mid, 3))}${e164.slice(-keepEnd)}`;
}

/**
 * Formats that work best for Google / Instagram / Facebook public search.
 * Egypt & many MENA numbers are indexed as 01xxxxxxxxx more than +20...
 */
export function phoneSearchFormats(phone: NormalizedPhone) {
	const e164 = phone.e164 || '';
	const e164Digits = e164.replace(/\D/g, '');
	const nationalDigits = (phone.national || '').replace(/\D/g, '');
	const withoutCountry = e164.replace(/^\+\d{1,3}/, '').replace(/\D/g, '');
	const localLeadingZero =
		nationalDigits.startsWith('0')
			? nationalDigits
			: withoutCountry
				? `0${withoutCountry}`
				: nationalDigits
					? `0${nationalDigits}`
					: '';

	const formats = {
		e164,
		e164Digits,
		nationalDigits,
		localLeadingZero,
		withoutCountry,
		/** Prefer local-leading-zero for social / web search in EG & similar */
		bestWebQuery: localLeadingZero || nationalDigits || e164Digits || e164,
	};

	const quotedCandidates = [
		formats.localLeadingZero,
		formats.nationalDigits,
		formats.withoutCountry,
		formats.e164,
		formats.e164Digits,
	].filter(Boolean);

	const uniqueQuoted = [...new Set(quotedCandidates)];

	return {
		...formats,
		quotedQueries: uniqueQuoted.map(v => `"${v}"`),
		siteQueries: (site: string) =>
			uniqueQuoted.slice(0, 2).map(v => `site:${site} "${v}"`),
	};
}

export function buildManualSearchLinks(phone: NormalizedPhone) {
	const f = phoneSearchFormats(phone);
	const q = (query: string) =>
		`https://www.google.com/search?q=${encodeURIComponent(query)}`;
	const best = f.bestWebQuery;
	const e164 = f.e164;

	return {
		truecaller: `https://www.truecaller.com/search/${encodeURIComponent(
			(phone.countryCode || 'eg').toLowerCase(),
		)}/${encodeURIComponent(e164.replace(/^\+/, ''))}`,
		googleLocal: q(`"${best}"`),
		googleE164: q(`"${e164}"`),
		bingLocal: `https://www.bing.com/search?q=${encodeURIComponent(`"${best}"`)}`,
		instagram: q(`site:instagram.com "${best}"`),
		facebook: q(`site:facebook.com "${best}"`),
		linkedin: q(`site:linkedin.com "${best}"`),
		twitter: q(`site:twitter.com OR site:x.com "${best}"`),
		tiktok: q(`site:tiktok.com "${best}"`),
		whatsappBusinessHint: q(`"${best}" WhatsApp OR واتساب OR "wa.me"`),
		companyAds: q(`"${best}" (شركة OR company OR gym OR عيادة OR contact OR تواصل)`),
	};
}

export function normalizePhone(
	raw: string,
	defaultCountry?: string,
): NormalizedPhone {
	const cleaned = String(raw || '').trim().replace(/[\s\-().]/g, '');
	const country = (defaultCountry || process.env.PHONE_DEFAULT_COUNTRY || 'EG')
		.toUpperCase()
		.replace(/^\+/, '') as CountryCode;

	let parsed = parsePhoneNumberFromString(
		cleaned.startsWith('+') ? cleaned : cleaned,
		cleaned.startsWith('+') ? undefined : country,
	);

	if (!parsed && !cleaned.startsWith('+')) {
		parsed = parsePhoneNumberFromString(`+${cleaned}`);
	}

	if (!parsed) {
		const fallback = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
		return {
			e164: fallback,
			national: cleaned,
			international: fallback,
			countryCode: null,
			callingCode: null,
			countryName: null,
			valid: false,
			possible: false,
			type: null,
			phoneHash: hashValue(fallback),
			e164Masked: maskE164(fallback),
		};
	}

	const e164 = parsed.format('E.164');
	const iso = parsed.country || null;
	let callingCode: string | null = null;
	try {
		callingCode = iso ? `+${getCountryCallingCode(iso)}` : `+${parsed.countryCallingCode}`;
	} catch {
		callingCode = `+${parsed.countryCallingCode}`;
	}

	return {
		e164,
		national: parsed.formatNational(),
		international: parsed.formatInternational(),
		countryCode: iso,
		callingCode,
		countryName: iso ? COUNTRY_NAMES[iso] || iso : null,
		valid: parsed.isValid(),
		possible: parsed.isPossible(),
		type: parsed.getType() || null,
		phoneHash: hashValue(e164),
		e164Masked: maskE164(e164),
	};
}

/** Egyptian / MENA carrier hints from leading digits (best-effort, not authoritative). */
export function guessCarrierFromNumber(e164: string, countryCode: string | null): string | null {
	const digits = e164.replace(/\D/g, '');
	if (countryCode === 'EG' || digits.startsWith('20')) {
		const local = digits.startsWith('20') ? digits.slice(2) : digits;
		if (local.startsWith('10') || local.startsWith('11') || local.startsWith('12') || local.startsWith('15')) {
			if (local.startsWith('10')) return 'Vodafone Egypt (likely)';
			if (local.startsWith('11')) return 'Etisalat / e& Egypt (likely)';
			if (local.startsWith('12')) return 'Orange Egypt (likely)';
			if (local.startsWith('15')) return 'WE Egypt (likely)';
		}
	}
	if (countryCode === 'SA' || digits.startsWith('966')) {
		const local = digits.startsWith('966') ? digits.slice(3) : digits;
		if (local.startsWith('50') || local.startsWith('53') || local.startsWith('55')) return 'STC (likely)';
		if (local.startsWith('54') || local.startsWith('56')) return 'Mobily (likely)';
		if (local.startsWith('57') || local.startsWith('58') || local.startsWith('59')) return 'Zain SA (likely)';
	}
	return null;
}

export function mapLineType(type: string | null | undefined): string | null {
	if (!type) return null;
	const map: Record<string, string> = {
		MOBILE: 'mobile',
		FIXED_LINE: 'landline',
		FIXED_LINE_OR_MOBILE: 'fixed_or_mobile',
		VOIP: 'voip',
		TOLL_FREE: 'toll_free',
		PREMIUM_RATE: 'premium',
		SHARED_COST: 'shared_cost',
		PERSONAL_NUMBER: 'personal',
		PAGER: 'pager',
		UAN: 'uan',
		VOICEMAIL: 'voicemail',
	};
	return map[type] || type.toLowerCase();
}
