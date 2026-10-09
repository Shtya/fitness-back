/**
 * Normalize Baileys `presence.update` into CRM presence fields.
 * WhatsApp streams contact presence only after `presenceSubscribe(jid)`.
 */

export type NormalizedContactPresence = {
	/** Preferred inbox id (@c.us when a phone mapping is known). */
	chatId: string;
	/** Raw id from the presence packet (often @lid). */
	chatIdRaw: string;
	/** Extra ids the sync layer should try when matching a conversation. */
	chatIdAliases: string[];
	phoneDigits: string | null;
	state: 'available' | 'unavailable' | 'composing' | 'recording';
	/** True for available / composing / recording — protocol presence, not CRM activity. */
	isOnline: boolean;
	typing: boolean;
	recording: boolean;
	lastSeen: number;
	/** WhatsApp privacy denied last-seen (`attrs.last === 'deny'`). */
	lastSeenRestricted: boolean;
};

function inboxJid(jid: string): string {
	const raw = String(jid || '').trim();
	if (!raw) return '';
	if (raw.endsWith('@s.whatsapp.net')) {
		return `${raw.slice(0, -'@s.whatsapp.net'.length)}@c.us`;
	}
	return raw;
}

function jidUser(value: unknown): string {
	if (!value) return '';
	if (typeof value === 'string') return inboxJid(value);
	const obj = value as { _serialized?: string; id?: string; user?: string };
	return inboxJid(String(obj._serialized || obj.id || obj.user || ''));
}

function phoneDigitsOf(jid: string): string | null {
	const id = String(jid || '');
	if (!id.endsWith('@c.us') && !id.endsWith('@s.whatsapp.net')) return null;
	const digits = id.split('@')[0].split(':')[0].replace(/\D/g, '');
	return digits.length >= 8 ? digits : null;
}

export function mapBaileysLastKnownPresence(
	lastKnown: string,
): NormalizedContactPresence['state'] | null {
	const value = String(lastKnown || '').toLowerCase().trim();
	if (!value) return null;
	if (value === 'composing') return 'composing';
	if (value === 'recording') return 'recording';
	if (value === 'available' || value === 'online' || value === 'paused') {
		// Baileys maps chatstate `paused` → available (still in the chat).
		return 'available';
	}
	if (value === 'unavailable' || value === 'offline') return 'unavailable';
	return null;
}

/**
 * @param update Baileys presence.update payload
 * @param resolvePhoneDigits optional LID → phone resolver (sync, from in-memory lid map)
 */
export function normalizeBaileysPresenceUpdate(
	update: any,
	resolvePhoneDigits?: (jid: string) => string | null | undefined,
): NormalizedContactPresence | null {
	const rawId = String(update?.id || '');
	const chatIdRaw = jidUser(update?.id) || inboxJid(rawId);
	if (!chatIdRaw) return null;

	const presences =
		update?.presences && typeof update.presences === 'object' ? update.presences : {};
	const firstKey = Object.keys(presences)[0] || '';
	const first = firstKey ? (presences as any)[firstKey] : null;
	const lastKnown =
		String(first?.lastKnownPresence || first?.lastKnown || '').toLowerCase() ||
		String(update?.lastKnownPresence || '').toLowerCase();
	const state = mapBaileysLastKnownPresence(lastKnown);
	if (!state) return null;

	const lastRaw = first?.lastSeen ?? first?.t ?? update?.lastSeen;
	const lastSeenRestricted =
		lastRaw === 'deny' ||
		String(first?.last || update?.last || '').toLowerCase() === 'deny';
	const rawLastSeen = Number(lastRaw);
	const lastSeen =
		!lastSeenRestricted && Number.isFinite(rawLastSeen) && rawLastSeen > 0
			? rawLastSeen < 1e12
				? rawLastSeen * 1000
				: rawLastSeen
			: 0;

	let phoneDigits =
		phoneDigitsOf(chatIdRaw) ||
		String(resolvePhoneDigits?.(chatIdRaw) || '').replace(/\D/g, '') ||
		null;
	if (phoneDigits && phoneDigits.length < 8) phoneDigits = null;

	const aliases = new Set<string>([chatIdRaw]);
	if (phoneDigits) {
		aliases.add(`${phoneDigits}@c.us`);
		aliases.add(`${phoneDigits}@s.whatsapp.net`);
	}
	const preferred =
		phoneDigits && (chatIdRaw.endsWith('@lid') || chatIdRaw.endsWith('@hosted.lid'))
			? `${phoneDigits}@c.us`
			: chatIdRaw.endsWith('@s.whatsapp.net')
				? `${chatIdRaw.slice(0, -'@s.whatsapp.net'.length)}@c.us`
				: chatIdRaw;
	aliases.add(preferred);

	const typing = state === 'composing';
	const recording = state === 'recording';
	const isOnline = state === 'available' || typing || recording;

	return {
		chatId: preferred,
		chatIdRaw,
		chatIdAliases: [...aliases],
		phoneDigits,
		state,
		isOnline,
		typing,
		recording,
		lastSeen,
		lastSeenRestricted,
	};
}
