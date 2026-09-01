export interface WhatsAppSharedContactPhone {
	label?: string | null;
	phone: string;
	waId?: string | null;
	formatted?: string | null;
}

export interface WhatsAppSharedContact {
	displayName: string;
	phones: WhatsAppSharedContactPhone[];
	waId?: string | null;
}

const CONTACT_TYPES = new Set([
	'contact',
	'contacts',
	'contactsarray',
	'vcard',
	'multi_vcard',
	'contact_card',
]);

export function isContactMessageType(type: unknown): boolean {
	return CONTACT_TYPES.has(String(type || '').toLowerCase());
}

export function looksLikeWhatsAppJid(value: unknown): boolean {
	const text = String(value || '').trim();
	return /@(c\.us|s\.whatsapp\.net|lid|hosted\.lid)$/i.test(text);
}

export function digitsFromWaId(value: unknown): string {
	return String(value || '')
		.replace(/@.*$/, '')
		.replace(/\D/g, '');
}

export function formatPhoneForDisplay(phone: string, waId?: string | null): string {
	const raw = String(phone || '').trim();
	if (raw.startsWith('+')) return raw.replace(/\s+/g, ' ').trim();
	const digits = digitsFromWaId(waId || raw);
	if (digits.length >= 8) return `+${digits}`;
	const cleaned = raw.replace(/[^\d+]/g, '');
	if (cleaned.startsWith('+')) return cleaned;
	if (cleaned.length >= 8) return `+${cleaned}`;
	return raw;
}

function decodeVcardValue(value: string): string {
	return String(value || '')
		.replace(/\\n/gi, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.trim();
}

export function parseVcardPhones(vcard: string): WhatsAppSharedContactPhone[] {
	const text = String(vcard || '').replace(/\r\n/g, '\n');
	if (!text.trim()) return [];
	const phones: WhatsAppSharedContactPhone[] = [];
	const seen = new Set<string>();
	for (const line of text.split('\n')) {
		if (!/^TEL/i.test(line.trim())) continue;
		const waidMatch = line.match(/waid=([0-9]+)/i);
		const waId = waidMatch?.[1] ? `${waidMatch[1]}@c.us` : null;
		const colonIndex = line.lastIndexOf(':');
		const afterColon = colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : '';
		const phone = decodeVcardValue(afterColon);
		const labelMatch = line.match(/type=([^;:]+)/i);
		const label = labelMatch?.[1] ? decodeVcardValue(labelMatch[1]) : null;
		const digits = digitsFromWaId(waId || phone);
		if (!digits && !phone) continue;
		const key = `${waId || ''}:${digits || phone}`;
		if (seen.has(key)) continue;
		seen.add(key);
		phones.push({
			label,
			phone: phone || (digits ? `+${digits}` : ''),
			waId,
			formatted: formatPhoneForDisplay(phone, waId),
		});
	}
	return phones;
}

function parseVcardName(vcard: string): string | null {
	const text = String(vcard || '');
	const fn = text.match(/^FN[^:]*:(.+)$/im)?.[1];
	if (fn) return decodeVcardValue(fn);
	const n = text.match(/^N[^:]*:(.+)$/im)?.[1];
	if (n) {
		const parts = decodeVcardValue(n).split(';').filter(Boolean);
		if (parts.length) return parts.join(' ').trim();
	}
	return null;
}

function phoneFromLooseValue(value: unknown): WhatsAppSharedContactPhone | null {
	const text = String(value || '').trim();
	if (!text || looksLikeWhatsAppJid(text) === false && !/^\+?\d{7,}$/.test(text.replace(/\s/g, ''))) {
		if (!looksLikeWhatsAppJid(text)) return null;
	}
	const waId = looksLikeWhatsAppJid(text) ? text : null;
	const digits = digitsFromWaId(waId || text);
	if (!digits || digits.length < 7) return null;
	return {
		phone: formatPhoneForDisplay(text, waId),
		waId: waId || `${digits}@c.us`,
		formatted: formatPhoneForDisplay(text, waId),
	};
}

function hasContactPayload(node: Record<string, any>): boolean {
	if (!node || typeof node !== 'object') return false;
	if (node.sharedContact?.displayName || node.sharedContact?.phones?.length) return true;
	if (node.contact?.displayName || node.contact?.phoneNumber || node.contact?.waId) return true;
	if (node.vcard || node.vcardFormattedName) return true;
	if (node.message?.contactMessage || node.contactMessage) return true;
	if (node.message?.contactsArrayMessage || node.contactsArrayMessage) return true;
	if (Array.isArray(node.vcardList) && node.vcardList.length) return true;
	return false;
}

function normalizeSharedContact(
	displayName: string,
	phones: WhatsAppSharedContactPhone[],
): WhatsAppSharedContact | null {
	const name = String(displayName || '').trim();
	const cleanedPhones = phones.filter(item => item?.phone || item?.waId);
	if (!cleanedPhones.length) return null;
	return {
		displayName: name || cleanedPhones[0]?.formatted || cleanedPhones[0]?.phone || 'Contact',
		phones: cleanedPhones,
		waId: cleanedPhones[0]?.waId || null,
	};
}

export function extractSharedContactFromRaw(
	raw: unknown,
	fallbackText?: string | null,
): WhatsAppSharedContact | null {
	if (!raw || typeof raw !== 'object') return null;
	const node = raw as Record<string, any>;
	if (!hasContactPayload(node)) return null;

	if (node.sharedContact?.displayName || node.sharedContact?.phones?.length) {
		return normalizeSharedContact(
			node.sharedContact.displayName,
			Array.isArray(node.sharedContact.phones)
				? node.sharedContact.phones.map((item: any) => ({
						label: item?.label || null,
						phone: String(item?.phone || item?.formatted || ''),
						waId: item?.waId || null,
						formatted: formatPhoneForDisplay(item?.phone || '', item?.waId),
					}))
				: [],
		);
	}

	if (node.contact?.displayName || node.contact?.phoneNumber) {
		const phone = phoneFromLooseValue(node.contact.phoneNumber || node.contact.waId);
		if (!phone) return null;
		return normalizeSharedContact(node.contact.displayName || fallbackText || '', [phone]);
	}

	const contactMessage =
		node.message?.contactMessage ||
		node.contactMessage ||
		null;
	const contactsArray =
		node.message?.contactsArrayMessage?.contacts ||
		node.contactsArrayMessage?.contacts ||
		node.vcardList ||
		null;

	const vcardSources: string[] = [];
	if (contactMessage?.vcard) vcardSources.push(String(contactMessage.vcard));
	if (node.vcard) vcardSources.push(String(node.vcard));
	if (Array.isArray(contactsArray)) {
		for (const entry of contactsArray) {
			if (entry?.vcard) vcardSources.push(String(entry.vcard));
			if (entry?.vCard) vcardSources.push(String(entry.vCard));
		}
	}

	const phones: WhatsAppSharedContactPhone[] = [];
	for (const vcard of vcardSources) phones.push(...parseVcardPhones(vcard));

	const displayName =
		String(
			contactMessage?.displayName ||
				node.vcardFormattedName ||
				node.notifyName ||
				(Array.isArray(contactsArray) ? contactsArray[0]?.displayName : '') ||
				parseVcardName(vcardSources[0] || '') ||
				'',
		).trim() || null;

	if (!phones.length) return null;

	const shared = normalizeSharedContact(displayName || 'Contact', phones);
	if (shared) return shared;

	// WPP sometimes stores only body + jid-like text without a vcard payload.
	const bodyName = String(node.body || node.caption || fallbackText || '').trim();
	if (bodyName && !looksLikeWhatsAppJid(bodyName)) {
		const loosePhone = phoneFromLooseValue(fallbackText);
		if (loosePhone) return normalizeSharedContact(bodyName, [loosePhone]);
	}

	return null;
}

export function enrichContactMessageNormalized<T extends { type?: string; text?: string | null; raw?: any }>(
	message: T,
): T {
	const shared = extractSharedContactFromRaw(message.raw, message.text);
	if (!shared) return message;
	const nextRaw =
		message.raw && typeof message.raw === 'object'
			? { ...message.raw, sharedContact: shared }
			: { sharedContact: shared };
	return {
		...message,
		type: 'contact',
		text: shared.displayName,
		raw: nextRaw,
	};
}
