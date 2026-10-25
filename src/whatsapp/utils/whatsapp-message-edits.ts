import type { WhatsAppMessageEditEntry } from '../entities/whatsapp.entity';

export const WHATSAPP_EDIT_HISTORY_LIMIT = 20;

/** WhatsApp accepts an edit only this long after the message was sent; later ones are dropped silently. */
export const WHATSAPP_EDIT_WINDOW_MINUTES = 15;

export function isWithinWhatsAppEditWindow(sentAt: Date | string | null | undefined, now = Date.now()): boolean {
	const at = new Date(sentAt ?? NaN).getTime();
	if (!Number.isFinite(at)) return false;
	return now - at <= WHATSAPP_EDIT_WINDOW_MINUTES * 60_000;
}

export type WhatsAppMessageEditSource = WhatsAppMessageEditEntry['by'];

function normalizeEntries(value: unknown): WhatsAppMessageEditEntry[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is WhatsAppMessageEditEntry =>
			Boolean(entry) &&
			typeof entry === 'object' &&
			typeof (entry as any).text === 'string' &&
			typeof (entry as any).previousText === 'string',
	);
}

/**
 * Returns the history with one more edit appended, or null when nothing changed.
 * The same edit arrives twice from Baileys (upsert + messages.update) and once more as the
 * echo of a CRM edit, so an entry that repeats the latest one is merged instead of appended.
 */
export function appendWhatsAppEditHistory(
	history: unknown,
	input: { previousText: string | null | undefined; text: string; editedAt: Date; by: WhatsAppMessageEditSource },
	limit = WHATSAPP_EDIT_HISTORY_LIMIT,
): WhatsAppMessageEditEntry[] | null {
	const entries = normalizeEntries(history);
	const text = String(input.text || '').trim();
	const previousText = String(input.previousText || '');
	const last = entries[entries.length - 1];
	if (!text) return null;
	if (last && last.text === text && last.previousText === previousText) {
		if (input.by !== 'staff' || last.by === 'staff') return null;
		return [...entries.slice(0, -1), { ...last, by: 'staff' }];
	}
	if (previousText.trim() === text) return null;
	const editedAt = Number.isFinite(input.editedAt?.getTime?.()) ? input.editedAt : new Date();
	const next = [...entries, { previousText, text, editedAt: editedAt.toISOString(), by: input.by }];
	return next.slice(-Math.max(1, limit));
}

export function whatsAppEditSource(direction: string | null | undefined, fromMe: boolean): WhatsAppMessageEditSource {
	if (fromMe || String(direction || '').toLowerCase() === 'outbound') return 'phone';
	return 'contact';
}
