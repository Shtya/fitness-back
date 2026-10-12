const MENTION_JID_PATTERN = /^(\d{5,32})(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/i;
const MAX_MENTIONS = 256;

/**
 * Keeps only member JIDs whose `@<digits>` token is actually present in the
 * text — WhatsApp renders a mention only when both sides agree.
 */
export function sanitizeWhatsAppOutboundMentions(
	text: string,
	mentions: unknown,
): string[] {
	if (!Array.isArray(mentions) || !mentions.length) return [];
	const body = String(text || '');
	const result = new Set<string>();
	for (const value of mentions) {
		const match = MENTION_JID_PATTERN.exec(String(value || '').trim());
		if (!match) continue;
		const digits = match[1];
		const server = match[2].toLowerCase();
		if (!new RegExp(`@${digits}(?!\\d)`).test(body)) continue;
		result.add(`${digits}@${server}`);
		if (result.size >= MAX_MENTIONS) break;
	}
	return [...result];
}
