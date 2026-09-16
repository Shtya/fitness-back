import * as path from 'path';

/**
 * Pure helpers for the saved-media library: naming, type mapping and path safety.
 * No filesystem or database access here so the rules stay unit-testable.
 */

export const MAX_LIBRARY_FOLDER_NAME = 120;
export const MAX_LIBRARY_ITEM_TITLE = 200;
export const MAX_LIBRARY_FOLDERS_PER_USER = 200;
export const MAX_LIBRARY_ITEMS_PER_USER = 2000;

/** Attachment/media types the library accepts, mapped to their send type. */
const SEND_TYPE_BY_MEDIA: Record<string, string> = {
	ptt: 'voice',
	voice: 'voice',
	audio: 'audio',
	image: 'image',
	sticker: 'sticker',
	video: 'video',
	document: 'document',
};

export function libraryMediaType(attachmentType: string | null | undefined): string | null {
	const key = String(attachmentType || '').toLowerCase();
	return SEND_TYPE_BY_MEDIA[key] || null;
}

export function isSupportedLibraryMediaType(attachmentType: string | null | undefined): boolean {
	return libraryMediaType(attachmentType) !== null;
}

export function normalizeFolderName(value: unknown): string {
	const name = String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return name.slice(0, MAX_LIBRARY_FOLDER_NAME);
}

export function normalizeItemTitle(value: unknown, fallback = 'Saved media'): string {
	const title = String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	return (title || fallback).slice(0, MAX_LIBRARY_ITEM_TITLE);
}

/**
 * A human title for something saved straight out of a chat, used when the caller
 * does not supply one.
 */
export function defaultItemTitle(
	mediaType: string,
	fileName?: string | null,
	durationSeconds?: number | null,
): string {
	const base = String(fileName || '').trim();
	if (base) return normalizeItemTitle(path.parse(base).name || base);
	const seconds = Number(durationSeconds);
	if (mediaType === 'voice' && Number.isFinite(seconds) && seconds > 0) {
		const mins = Math.floor(seconds / 60);
		const secs = String(Math.floor(seconds % 60)).padStart(2, '0');
		return `Voice note ${mins}:${secs}`;
	}
	return normalizeItemTitle(mediaType ? `${mediaType[0].toUpperCase()}${mediaType.slice(1)}` : '');
}

/** Extension for the library copy, preferring the original name then the MIME type. */
export function libraryFileExtension(
	fileName?: string | null,
	mimeType?: string | null,
	mediaType?: string | null,
): string {
	const fromName = path.extname(String(fileName || '')).replace(/[^.a-z0-9]/gi, '');
	if (fromName && fromName.length <= 6) return fromName.toLowerCase();
	const subtype = String(mimeType || '')
		.split('/')[1]
		?.split(/[;+]/)[0]
		?.toLowerCase();
	if (subtype) {
		// Subtypes whose name is not a usable extension, checked before the length
		// guard below since some of them are longer than a real extension.
		if (subtype === 'quicktime') return '.mov';
		if (subtype === 'mpeg') return mediaType === 'audio' || mediaType === 'voice' ? '.mp3' : '.mpeg';
		if (/^[a-z0-9]{1,6}$/.test(subtype)) return `.${subtype}`;
	}
	if (mediaType === 'voice') return '.ogg';
	return '.bin';
}

/**
 * Storage-relative path for a library file, namespaced per user.
 *
 * The random suffix means saving the same source twice never overwrites the first
 * copy, which matters because items are independent records.
 */
export function libraryStorageRelativePath(
	userId: string,
	mediaType: string,
	extension: string,
	now = Date.now(),
	random = Math.random().toString(36).slice(2, 8),
): string {
	const safeUser = String(userId || '').replace(/[^a-z0-9-]/gi, '');
	const safeType = String(mediaType || 'media').replace(/[^a-z0-9]/gi, '') || 'media';
	const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
	return `library/${safeUser}/${safeType}-${now}-${random}${safeExt}`;
}

/**
 * Guards against a stored path escaping the media root via `..` or an absolute
 * path, which would otherwise let a tampered row read arbitrary files.
 */
export function resolveLibraryPathInsideRoot(root: string, storagePath: string): string | null {
	const relative = String(storagePath || '').replace(/\\/g, '/');
	if (!relative || relative.includes('..') || relative.startsWith('/') || path.isAbsolute(relative)) {
		return null;
	}
	const absoluteRoot = path.resolve(root);
	const resolved = path.resolve(absoluteRoot, relative);
	if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
		return null;
	}
	return resolved;
}
