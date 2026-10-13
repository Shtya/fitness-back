/**
 * View-once media: WhatsApp only lets the recipient's phone open it. Linked
 * devices (WhatsApp Web/Desktop) show a placeholder instead, so this app does
 * the same — the bytes and the inline thumbnail never reach the browser.
 */
const VIEW_ONCE_WRAPPERS = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
const MEDIA_NODES = ['imageMessage', 'videoMessage', 'audioMessage'];

function unwrapEphemeral(message: any): any {
	if (!message || typeof message !== 'object') return null;
	return message.ephemeralMessage?.message || message;
}

export function isWhatsAppViewOnceRaw(raw: unknown): boolean {
	if (!raw || typeof raw !== 'object') return false;
	const source = raw as Record<string, any>;
	// WPPConnect payloads flag it on the message itself.
	if (source.isViewOnce === true) return true;
	const message = unwrapEphemeral(source.message);
	if (!message) return false;
	if (VIEW_ONCE_WRAPPERS.some((key) => message[key])) return true;
	return MEDIA_NODES.some((key) => message[key]?.viewOnce === true);
}

/** Drops the inline preview and caption — jpegThumbnail is a readable copy of the photo. */
export function stripViewOnceRawPreview<T>(raw: T): T {
	if (!raw || typeof raw !== 'object') return raw;
	const source = raw as Record<string, any>;
	const strip = (node: any) => {
		if (!node || typeof node !== 'object') return node;
		const copy = { ...node };
		delete copy.jpegThumbnail;
		delete copy.thumbnail;
		delete copy.caption;
		return copy;
	};
	const rewrite = (message: any): any => {
		if (!message || typeof message !== 'object') return message;
		const next = { ...message };
		if (next.ephemeralMessage?.message) {
			next.ephemeralMessage = { ...next.ephemeralMessage, message: rewrite(next.ephemeralMessage.message) };
		}
		for (const key of VIEW_ONCE_WRAPPERS) {
			if (next[key]?.message) next[key] = { ...next[key], message: rewrite(next[key].message) };
		}
		for (const key of MEDIA_NODES) {
			if (next[key]) next[key] = strip(next[key]);
		}
		return next;
	};
	const output: Record<string, any> = { ...source, message: rewrite(source.message) };
	delete output.body;
	return output as T;
}

/** A reply's `contextInfo.quotedMessage` is a copy of the quoted message, preview included. */
export function isWhatsAppViewOnceQuoted(quotedMessage: unknown): boolean {
	return isWhatsAppViewOnceRaw({ message: quotedMessage });
}

const MAX_QUOTED_DEPTH = 12;

/**
 * Strips caption/thumbnail from every view-once `quotedMessage` inside `raw`.
 * Returns the same object when nothing was quoted from a view-once message.
 */
export function stripViewOnceQuotedPreviews<T>(raw: T, depth = 0): T {
	if (!raw || typeof raw !== 'object' || depth >= MAX_QUOTED_DEPTH) return raw;
	if (raw instanceof Uint8Array) return raw;
	if (Array.isArray(raw)) {
		let changed = false;
		const items = raw.map((item) => {
			const next = stripViewOnceQuotedPreviews(item, depth + 1);
			if (next !== item) changed = true;
			return next;
		});
		return (changed ? items : raw) as T;
	}
	const source = raw as Record<string, any>;
	let output: Record<string, any> | null = null;
	for (const key of Object.keys(source)) {
		const value = source[key];
		if (!value || typeof value !== 'object') continue;
		const next =
			key === 'quotedMessage' && isWhatsAppViewOnceQuoted(value)
				? stripViewOnceRawPreview({ message: value }).message
				: stripViewOnceQuotedPreviews(value, depth + 1);
		if (next === value) continue;
		output ??= { ...source };
		output[key] = next;
	}
	return (output ?? source) as T;
}
