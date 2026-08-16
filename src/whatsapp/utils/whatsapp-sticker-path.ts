import * as path from 'path';

export function normalizeStorageKey(storagePath: string) {
	return String(storagePath || '')
		.replace(/\\/g, '/')
		.replace(/^\/+/, '');
}

export function mediaRelativeKey(storagePath: string) {
	const posix = String(storagePath || '').replace(/\\/g, '/');
	const mediaMatch = posix.match(/(?:^|\/)whatsapp-media\/(.+)$/i);
	if (mediaMatch?.[1]) return mediaMatch[1];
	const stickerMatch = posix.match(/(?:^|\/)(stickers\/.+)$/i);
	if (stickerMatch?.[1]) return stickerMatch[1];
	return normalizeStorageKey(posix).replace(/^[a-zA-Z]:\//, '');
}

export function stickerPathTail(storagePath: string) {
	const relative = mediaRelativeKey(storagePath);
	const index = relative.toLowerCase().indexOf('stickers/');
	return index >= 0 ? relative.slice(index) : relative;
}

export function isPathInside(absolutePath: string, root: string) {
	const resolved = path.resolve(absolutePath);
	const base = path.resolve(root);
	return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

export function mediaFileCandidates(
	storagePath: string,
	options: { cwd: string; mediaRoot: string; extraRoots?: string[] },
) {
	if (!storagePath) return [];
	const posix = String(storagePath).replace(/\\/g, '/');
	const relative = mediaRelativeKey(storagePath);
	const extra = options.extraRoots || [];
	const maybeAbsolute = [
		path.posix.isAbsolute(posix) ? posix : '',
		path.win32.isAbsolute(storagePath) || path.win32.isAbsolute(posix) ? storagePath : '',
	];
	const values = [
		...maybeAbsolute,
		path.resolve(options.cwd, normalizeStorageKey(posix)),
		path.resolve(options.mediaRoot, relative),
		path.resolve(options.cwd, 'storage', 'whatsapp-media', relative),
		...extra.flatMap((root) => [
			path.resolve(root, relative),
			path.resolve(root, normalizeStorageKey(posix)),
		]),
	]
		.filter(Boolean)
		.map((item) => path.resolve(item));
	return [...new Set(values)];
}

export function stickerFileCandidates(
	storagePath: string,
	options: { cwd: string; mediaRoot: string; extraRoots?: string[] },
) {
	return mediaFileCandidates(storagePath, options);
}
