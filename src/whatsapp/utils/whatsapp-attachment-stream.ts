import { createReadStream } from 'fs';
import * as fs from 'fs';
import type { Request, Response } from 'express';
import { StreamableFile } from '@nestjs/common';
import { parseByteRange } from './whatsapp-byte-range';

const INLINE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'audio/mpeg',
	'audio/ogg',
	'audio/mp4',
	'audio/webm',
	'video/mp4',
	'video/webm',
]);

export async function streamResolvedAttachment(
	req: Request,
	res: Response,
	file: { absolutePath: string; mimeType?: string | null; fileName?: string | null },
	attachmentId: string,
): Promise<StreamableFile | undefined> {
	const mimeType = String(file.mimeType || 'application/octet-stream')
		.toLowerCase()
		.split(';')[0];
	const inline =
		INLINE_TYPES.has(mimeType) ||
		mimeType.startsWith('image/') ||
		mimeType.startsWith('audio/') ||
		mimeType.startsWith('video/');
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('Content-Type', inline ? mimeType : 'application/octet-stream');
	res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
	res.setHeader(
		'Content-Disposition',
		`${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.fileName || 'attachment')}"`,
	);

	let size: number | null = null;
	try {
		const stats = await fs.promises.stat(file.absolutePath);
		size = stats.size;
		const etag = `"wa-${attachmentId}-${stats.size}-${stats.mtimeMs}"`;
		res.setHeader('ETag', etag);
		if (String(req.headers['if-none-match'] || '') === etag) {
			res.status(304);
			return undefined;
		}
	} catch {
		/* ignore etag failures */
	}

	if (!inline || size == null) {
		return new StreamableFile(createReadStream(file.absolutePath));
	}
	res.setHeader('Accept-Ranges', 'bytes');
	const range = parseByteRange(String(req.headers.range || ''), size);
	if (range === 'unsatisfiable') {
		res.status(416);
		res.setHeader('Content-Range', `bytes */${size}`);
		return undefined;
	}
	if (!range) {
		res.setHeader('Content-Length', String(size));
		return new StreamableFile(createReadStream(file.absolutePath));
	}
	res.status(206);
	res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
	res.setHeader('Content-Length', String(range.end - range.start + 1));
	return new StreamableFile(
		createReadStream(file.absolutePath, { start: range.start, end: range.end }),
	);
}
