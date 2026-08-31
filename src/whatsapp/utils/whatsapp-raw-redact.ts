/**
 * Media decryption material lives inside `whatsapp_messages.raw` because the
 * server needs it to re-fetch media from WhatsApp later (`downloadMedia` rawHint).
 * The browser never reads it — media always arrives through our authenticated
 * `/attachments/:id/content` endpoint — so it must not be shipped to clients.
 *
 * `jpegThumbnail` is deliberately kept: the chat bubbles use it as the blurred
 * placeholder fallback when `previewDataUrl` is absent.
 */
const REDACTED_KEYS = new Set([
	'mediaKey',
	'mediaKeyTimestamp',
	'fileSha256',
	'fileEncSha256',
	'directPath',
	'streamingSidecar',
	'thumbnailDirectPath',
	'thumbnailSha256',
	'thumbnailEncSha256',
]);

const MAX_DEPTH = 12;

/**
 * Returns a copy of `value` with media-crypto fields removed at every depth.
 * The input is never mutated, so the caller's entity keeps the fields it needs
 * if it is still going to be persisted.
 */
export function redactRawForClient<T>(value: T, depth = 0): T {
	if (value == null || typeof value !== 'object') return value;
	if (depth >= MAX_DEPTH) return value;

	if (Array.isArray(value)) {
		return value.map(item => redactRawForClient(item, depth + 1)) as unknown as T;
	}

	// Buffers/typed arrays are leaves; cloning them key-by-key would corrupt them.
	if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;

	const source = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	for (const key of Object.keys(source)) {
		if (REDACTED_KEYS.has(key)) continue;
		output[key] = redactRawForClient(source[key], depth + 1);
	}
	return output as unknown as T;
}

/** Applies {@link redactRawForClient} to the `raw` column of outbound messages. */
export function redactMessagesRawForClient<T extends { raw?: unknown }>(
	messages: T[],
): T[] {
	for (const message of messages || []) {
		if (message?.raw && typeof message.raw === 'object') {
			(message as { raw?: unknown }).raw = redactRawForClient(message.raw);
		}
	}
	return messages;
}
