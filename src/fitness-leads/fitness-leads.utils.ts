import {
	BUSINESS_TYPE_KEYWORDS,
	EXCLUDED_EMAIL_PREFIXES,
	FREE_EMAIL_DOMAINS,
	GENERIC_EMAIL_PREFIXES,
} from './fitness-leads.config';

export function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export function normalizeEmail(email: string) {
	return String(email || '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '');
}

export function isValidEmailFormat(email: string) {
	return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

export function deobfuscateEmails(text: string): string[] {
	if (!text) return [];
	const patterns = [
		/([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\sat\s)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*([a-zA-Z]{2,})/gi,
		/([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
	];
	const found: string[] = [];
	for (const re of patterns) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(text))) {
			const email =
				m.length >= 4 ? `${m[1]}@${m[2]}.${m[3]}` : `${m[1]}@${m[2]}`;
			found.push(normalizeEmail(email));
		}
	}
	return found;
}

export function extractEmailsFromHtml(html: string): string[] {
	if (!html) return [];
	const text = html
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ');
	const mailto = [...text.matchAll(/mailto:([^\s"'?>]+)/gi)].map(m =>
		normalizeEmail(decodeURIComponent(m[1].split('?')[0])),
	);
	const plain = [...text.matchAll(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)].map(m =>
		normalizeEmail(m[0]),
	);
	return [...new Set([...mailto, ...plain, ...deobfuscateEmails(text)])];
}

export function filterValidBusinessEmails(emails: string[]): string[] {
	return [...new Set(emails.map(normalizeEmail))]
		.filter(isValidEmailFormat)
		.filter(email => {
			const prefix = email.split('@')[0];
			return !EXCLUDED_EMAIL_PREFIXES.some(p => prefix.startsWith(p));
		});
}

export function classifyEmailType(email: string): string {
	const [prefix, domain] = email.split('@');
	if (FREE_EMAIL_DOMAINS.includes(domain)) return 'Public Professional';
	if (GENERIC_EMAIL_PREFIXES.includes(prefix)) return 'Generic';
	return 'Public Business';
}

export function getBestEmail(emails: string[]): string | null {
	const list = filterValidBusinessEmails(emails);
	if (!list.length) return null;
	const ranked = [...list].sort((a, b) => {
		const score = (e: string) => {
			const [p, d] = e.split('@');
			let s = 0;
			if (!FREE_EMAIL_DOMAINS.includes(d)) s += 3;
			if (GENERIC_EMAIL_PREFIXES.includes(p)) s += 2;
			if (['info', 'contact', 'hello', 'membership'].includes(p)) s += 1;
			return s;
		};
		return score(b) - score(a);
	});
	return ranked[0];
}

export function getVerificationStatus(email: string, websiteFound: boolean): string {
	if (!email) return 'No Email Found';
	if (websiteFound) return 'Likely Valid';
	return 'Unverified';
}

export function classifyBusinessType(name?: string | null): string {
	const lower = String(name || '').toLowerCase();
	for (const [type, keys] of Object.entries(BUSINESS_TYPE_KEYWORDS)) {
		if (keys.some(k => lower.includes(k.toLowerCase()))) return type;
	}
	return 'Gym';
}

export function extractCityFromAddress(
	address: string,
	knownCities: string[],
	fallback: string,
): string {
	const lower = String(address || '').toLowerCase();
	for (const city of knownCities) {
		if (lower.includes(city.toLowerCase())) return city;
	}
	return fallback;
}

const NEIGHBORHOOD_COMPONENT_TYPES = [
	'neighborhood',
	'sublocality_level_1',
	'sublocality',
	'sublocality_level_2',
	'administrative_area_level_3',
	'administrative_area_level_2',
];

/** Prefer Places addressComponents; fall back to parsing formatted address (e.g. حي …). */
export function extractNeighborhood(place: any, cityHint?: string): string {
	const components: any[] = place?.addressComponents || place?.address_components || [];
	for (const type of NEIGHBORHOOD_COMPONENT_TYPES) {
		const hit = components.find((c: any) =>
			(c.types || []).map((t: string) => String(t).toLowerCase()).includes(type),
		);
		const label = String(hit?.longText || hit?.long_name || hit?.shortText || hit?.short_name || '').trim();
		if (!label) continue;
		const city = String(cityHint || '').trim().toLowerCase();
		if (city && label.toLowerCase() === city) continue;
		return label;
	}

	const address = String(place?.formattedAddress || place?.shortFormattedAddress || '').trim();
	if (!address) return '';

	const arabicHay = address.match(/(?:حي|حى|منطقة|ضاحية|قطاع)\s+[\u0600-\u06FF0-9\s-]{2,40}/);
	if (arabicHay) {
		return arabicHay[0].replace(/\s+/g, ' ').replace(/[,،].*$/, '').trim();
	}

	const parts = address
		.split(/[,،]/)
		.map(p => p.trim())
		.filter(Boolean);
	const cityLower = String(cityHint || '').toLowerCase();
	// Prefer a part that looks like a district (not street numbers / country codes).
	for (const part of parts) {
		const lower = part.toLowerCase();
		if (cityLower && lower === cityLower) continue;
		if (/^\d+$/.test(part)) continue;
		if (/^(egypt|saudi|uae|jordan|kuwait|qatar|bahrain|oman|مصر|السعودية)$/i.test(part)) continue;
		if (/street|st\.|road|rd\.|avenue|شارع|طريق/i.test(part)) continue;
		if (parts.indexOf(part) === 0 && /\d/.test(part)) continue;
		// Second segment is often suburb/district in MENA formatted addresses.
		if (parts.length >= 2 && part === parts[1]) return part;
	}
	if (parts.length >= 3) return parts[1];
	return '';
}

export function extractSocialLinks(html: string) {
	const social = {
		instagram: '',
		linkedin: '',
		facebook: '',
		twitter: '',
		tiktok: '',
		youtube: '',
		whatsapp: '',
	};
	if (!html) return social;
	const take = (re: RegExp) => {
		const m = html.match(re);
		return m ? m[0].split(/["'\s>]/)[0] : '';
	};
	social.instagram = take(/https?:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._%-]+\/?/i);
	social.linkedin = take(
		/https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[A-Za-z0-9._%-]+\/?/i,
	);
	social.facebook = take(
		/https?:\/\/(?:www\.)?(?:facebook|fb)\.com\/(?!sharer|share|dialog)[A-Za-z0-9._%-]+\/?/i,
	);
	social.twitter = take(/https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[A-Za-z0-9._%-]+\/?/i);
	social.tiktok = take(/https?:\/\/(?:www\.)?tiktok\.com\/@?[A-Za-z0-9._%-]+\/?/i);
	social.youtube = take(
		/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:channel|c|@|user)\/[A-Za-z0-9._%-]+|youtu\.be\/[A-Za-z0-9_-]+)\/?/i,
	);
	social.whatsapp = take(/https?:\/\/(?:wa\.me|api\.whatsapp\.com\/send)\/[^\s"'<>]+/i);
	return social;
}

export function extractWhatsAppFromPhone(phone?: string | null) {
	if (!phone) return '';
	const digits = phone.replace(/\D/g, '');
	return digits.length >= 10 ? `https://wa.me/${digits}` : '';
}

export function placeKey(place: any) {
	return (
		place?.id ||
		`${(place?.displayName?.text || '').toLowerCase()}|${place?.websiteUri || ''}|${
			place?.internationalPhoneNumber || place?.nationalPhoneNumber || ''
		}`
	);
}

export function dedupePlaces(places: any[]) {
	const seen = new Set<string>();
	return places.filter(p => {
		const key = placeKey(p);
		if (!key || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
