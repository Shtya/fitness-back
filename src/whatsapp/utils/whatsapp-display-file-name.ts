/**
 * User-facing file names for outgoing media.
 *
 * Files are stored under unique internal names (upload: `<ms>-<rand>.ext`,
 * share/forward: `share_<ms>_<hex8>_<name>`, saved media: `<name>-<ms>-<rand6>.ext`).
 * Those names are storage identifiers only — WhatsApp and the inbox must receive
 * the original name the user picked.
 */

const MAX_DISPLAY_NAME_LENGTH = 200;

const UPLOAD_STORAGE_NAME = /^\d{12,14}-[a-z0-9]{4,12}(?:-voice-\d+s)?(\.[a-z0-9]{1,12})?$/i;
const SHARE_STORAGE_PREFIX = /^share_\d{12,14}_[0-9a-f]{8}_/i;
const SAVED_MEDIA_SUFFIX = /-\d{12,14}-[a-z0-9]{6}(\.[a-z0-9]{1,12})?$/i;

/** Scripts that survive multipart mangling and prove a latin1→utf8 repair worked. */
const NON_LATIN_SCRIPT =
	/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u4E00-\u9FFF\u0400-\u04FF\u0900-\u097F]/;

/**
 * Multer / Busboy decode Content-Disposition filenames as Latin-1.
 * UTF-8 Arabic (and similar) then shows as mojibake: "أسئلة" → "ø§ø³ø¦…".
 * Only rewriting when the result clearly recovers real script text.
 */
export function decodeMultipartFileName(value: unknown): string {
	const raw = String(value ?? '');
	if (!raw) return '';
	if (NON_LATIN_SCRIPT.test(raw)) return raw;
	try {
		const decoded = Buffer.from(raw, 'latin1').toString('utf8');
		if (!decoded || decoded === raw || decoded.includes('\uFFFD')) return raw;
		if (NON_LATIN_SCRIPT.test(decoded)) return decoded;
	} catch {
		/* keep raw */
	}
	return raw;
}

/** Basename with control / bidi-override characters removed; null when nothing usable is left. */
export function sanitizeDisplayFileName(value: unknown): string | null {
	const base = decodeMultipartFileName(value)
		.split(/[\\/]/)
		.pop()!
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	if (!base || base === '.' || base === '..') return null;
	if (base.length <= MAX_DISPLAY_NAME_LENGTH) return base;
	const dot = base.lastIndexOf('.');
	const ext = dot > 0 && base.length - dot <= 13 ? base.slice(dot) : '';
	return `${base.slice(0, MAX_DISPLAY_NAME_LENGTH - ext.length).trimEnd()}${ext}`;
}

/**
 * Recovers the original name from a name this app generated for storage.
 * Returns null when the storage name carries no original name (plain uploads).
 */
export function originalNameFromStorageName(value: unknown): string | null {
	const name = sanitizeDisplayFileName(value);
	if (!name) return null;
	if (UPLOAD_STORAGE_NAME.test(name)) return null;
	if (SHARE_STORAGE_PREFIX.test(name)) {
		return sanitizeDisplayFileName(name.replace(SHARE_STORAGE_PREFIX, ''));
	}
	if (SAVED_MEDIA_SUFFIX.test(name)) {
		const ext = name.match(SAVED_MEDIA_SUFFIX)?.[1] || '';
		const stem = name.replace(SAVED_MEDIA_SUFFIX, '');
		return stem ? `${stem}${ext}` : null;
	}
	return name;
}

/** True when the name is one of this app's internal storage names, not something a user chose. */
export function isInternalStorageFileName(value: unknown): boolean {
	const name = sanitizeDisplayFileName(value);
	if (!name) return false;
	return (
		UPLOAD_STORAGE_NAME.test(name) || SHARE_STORAGE_PREFIX.test(name) || SAVED_MEDIA_SUFFIX.test(name)
	);
}

function extensionOf(name: string | null | undefined): string {
	const match = String(name || '').match(/(\.[a-z0-9]{1,12})$/i);
	return match ? match[1].toLowerCase() : '';
}

/**
 * Name sent to WhatsApp and stored on the attachment row.
 * Order: name the client supplied → original recovered from the storage name →
 * a neutral fallback that keeps the real extension.
 */
export function resolveOutgoingDisplayFileName(input: {
	requested?: unknown;
	storagePath: string;
	type?: string | null;
}): string {
	const requested = originalNameFromStorageName(input.requested);
	const storageBase = String(input.storagePath || '').split(/[\\/]/).pop() || '';
	const storageExt = extensionOf(storageBase);
	if (requested) {
		return extensionOf(requested) || !storageExt ? requested : `${requested}${storageExt}`;
	}
	const recovered = originalNameFromStorageName(storageBase);
	if (recovered) return recovered;
	const kind = String(input.type || '').toLowerCase();
	const stem =
		kind === 'image' || kind === 'sticker'
			? 'image'
			: kind === 'video'
				? 'video'
				: kind === 'audio' || kind === 'voice' || kind === 'ptt'
					? 'audio'
					: 'document';
	return `${stem}${storageExt}`;
}

/** RFC 6266 header: ASCII fallback plus the exact UTF-8 name, so Arabic names survive downloads. */
export function contentDispositionHeader(kind: 'inline' | 'attachment', fileName: unknown): string {
	const name = sanitizeDisplayFileName(fileName) || 'attachment';
	const ascii =
		name
			.normalize('NFKD')
			.replace(/[^\x20-\x7e]/g, '_')
			.replace(/["\\]/g, '_')
			.replace(/_{2,}/g, '_') || 'attachment';
	const encoded = encodeURIComponent(name).replace(/['()*]/g, c =>
		`%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
