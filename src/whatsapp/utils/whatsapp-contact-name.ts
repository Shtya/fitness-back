/**
 * WhatsApp-style contact labels.
 *
 * Priority (matches the mobile client):
 * 1. Address-book / saved contact name
 * 2. Profile display name (pushName / notify)
 * 3. Phone number (caller formats separately)
 *
 * Baileys fields: `name` = saved contact, `notify` = pushName the peer set.
 */

export function isWeakWhatsAppContactName(
	name: string | null | undefined,
	chatId?: string | null,
	phone?: string | null,
): boolean {
	const n = String(name || '').trim();
	if (!n) return true;
	const phoneDigits = String(phone || '').replace(/\D/g, '');
	if (phoneDigits && n.replace(/\D/g, '') === phoneDigits && /^\+?\d[\d\s-]*$/.test(n)) {
		return true;
	}
	const user = String(chatId || '')
		.split('@')[0]
		.split(':')[0]
		.trim();
	if (user && n === user) return true;
	if (/^\d{8,32}$/.test(n)) return true;
	return false;
}

/** Pick the best label without demoting a stronger existing name. */
export function preferWhatsAppContactName(
	existing: string | null | undefined,
	incoming: string | null | undefined,
	chatId?: string | null,
	phone?: string | null,
): string | null {
	const prev = String(existing || '').trim() || null;
	const next = String(incoming || '').trim() || null;
	const prevWeak = isWeakWhatsAppContactName(prev, chatId, phone);
	const nextWeak = isWeakWhatsAppContactName(next, chatId, phone);
	if (!next || nextWeak) return prevWeak ? null : prev;
	if (!prev || prevWeak) return next;
	return prev;
}

/**
 * Resolve display label from separate address-book + pushName fields.
 * Saved name always wins when present and strong.
 */
export function resolveWhatsAppContactLabel(input: {
	savedName?: string | null;
	pushName?: string | null;
	chatId?: string | null;
	phone?: string | null;
}): string | null {
	const saved = String(input.savedName || '').trim() || null;
	const push = String(input.pushName || '').trim() || null;
	const chatId = input.chatId;
	const phone = input.phone;
	if (saved && !isWeakWhatsAppContactName(saved, chatId, phone)) return saved;
	if (push && !isWeakWhatsAppContactName(push, chatId, phone)) return push;
	return null;
}
