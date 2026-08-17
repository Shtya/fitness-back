export function decodeProviderMedia(data: any): Buffer {
	const value = data?.data ?? data?.base64 ?? data;
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (Array.isArray(value)) return Buffer.from(value);
	if (value?.type === 'Buffer' && Array.isArray(value.data)) {
		return Buffer.from(value.data);
	}
	if (typeof value !== 'string') {
		throw new Error('Provider returned an unsupported media payload');
	}
	const raw = value
		.replace(/^data:[^,]*;base64,/i, '')
		.replace(/\s+/g, '')
		.trim();
	if (!raw || !/^[a-z0-9+/]+={0,2}$/i.test(raw)) {
		throw new Error('Provider returned invalid base64 media');
	}
	return Buffer.from(raw, 'base64');
}

/** WhatsApp jpegThumbnails are tiny JPEGs. Status video often arrives as that preview. */
export function isIncompleteStatusMedia(
	buffer: Buffer | null | undefined,
	detectedMime: string | null | undefined,
	statusType?: string | null,
): boolean {
	if (!buffer?.length) return true;
	const type = String(statusType || '').toLowerCase();
	const mime = String(detectedMime || '').toLowerCase();
	if (type.includes('video') && mime.startsWith('image/')) return true;
	if (mime.startsWith('video/')) return buffer.length < 20_000;
	if (mime.startsWith('image/')) return buffer.length < 8_000;
	return buffer.length < 8_000;
}
