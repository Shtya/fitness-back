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
