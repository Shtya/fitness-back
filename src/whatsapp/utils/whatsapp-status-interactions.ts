import { whatsAppReceiptBaseKey } from './whatsapp-group-receipts';

export const STATUS_BROADCAST_JID = 'status@broadcast';

/** Quick reactions offered on a story; any single emoji is accepted. */
export const STATUS_QUICK_REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'];

/**
 * The bare WhatsApp message id of a story.
 *
 * Stories are stored under a serialized id (`true_status@broadcast_<id>_<jid>`), but
 * receipts and status replies only ever reference the bare `<id>`.
 */
export function statusMessageKey(providerStatusId: string | null | undefined): string {
	const id = String(providerStatusId || '').trim();
	if (!id) return '';
	const serialized = id.match(/status@broadcast_([^_]+)/i)?.[1];
	return (serialized || id).slice(0, 200);
}

/**
 * Canonical viewer identity: device suffix dropped, lowercase, and the legacy `@c.us`
 * spelling folded into `@s.whatsapp.net` so a receipt and a chat message from the
 * same person land on the same key.
 */
export function statusActorKey(jid: string | null | undefined): string {
	const key = whatsAppReceiptBaseKey(String(jid || ''));
	if (!key.includes('@')) return '';
	return key.replace(/@c\.us$/, '@s.whatsapp.net').slice(0, 200);
}

function graphemes(value: string): string[] {
	const Segmenter = (Intl as any).Segmenter;
	if (typeof Segmenter === 'function') {
		return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
			(part: { segment: string }) => part.segment,
		);
	}
	return Array.from(value);
}

/**
 * WhatsApp sends a story reaction as a status reply whose whole text is one emoji,
 * so the same test classifies inbound replies and validates outbound reactions.
 */
export function isStatusReactionText(text: string | null | undefined): boolean {
	const value = String(text || '').trim();
	if (!value || value.length > 32) return false;
	if (graphemes(value).length !== 1 || /\p{L}/u.test(value)) return false;
	return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(value);
}

export interface StatusQuoteRef {
	statusMessageId: string;
	ownerJid: string | null;
}

/** The story a message replies to, read from its Baileys `contextInfo`. */
export function statusQuoteFromContextInfo(contextInfo: any): StatusQuoteRef | null {
	if (!contextInfo || typeof contextInfo !== 'object') return null;
	if (String(contextInfo.remoteJid || '').trim().toLowerCase() !== STATUS_BROADCAST_JID) {
		return null;
	}
	const statusMessageId = String(contextInfo.stanzaId || '').trim();
	if (!statusMessageId) return null;
	const ownerJid = String(contextInfo.participant || '').trim() || null;
	return { statusMessageId: statusMessageId.slice(0, 200), ownerJid };
}
