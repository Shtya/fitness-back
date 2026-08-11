function bytesToBase64(value: any): string | undefined {
	if (value == null) return undefined;
	if (typeof value === 'string') return value;
	if (Buffer.isBuffer(value)) return value.toString('base64');
	if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
	if (value?.type === 'Buffer' && Array.isArray(value.data)) {
		return Buffer.from(value.data).toString('base64');
	}
	return undefined;
}

function base64ToBuffer(value: any): Buffer | undefined {
	if (value == null) return undefined;
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value);
	if (typeof value === 'string' && value.length) {
		try {
			return Buffer.from(value, 'base64');
		} catch {
			return undefined;
		}
	}
	if (value?.type === 'Buffer' && Array.isArray(value.data)) {
		return Buffer.from(value.data);
	}
	return undefined;
}

const BAILEYS_MEDIA_BYTE_KEYS = [
	'mediaKey',
	'fileSha256',
	'fileEncSha256',
	'jpegThumbnail',
	'mediaKeyTimestamp',
] as const;

function sanitizeBaileysMediaNode(node: any) {
	if (!node || typeof node !== 'object') return null;
	const out: Record<string, unknown> = { ...node };
	for (const key of BAILEYS_MEDIA_BYTE_KEYS) {
		if (out[key] != null) {
			const encoded = bytesToBase64(out[key]);
			if (encoded) out[key] = encoded;
		}
	}
	return out;
}

function reviveBaileysMediaNode(node: any) {
	if (!node || typeof node !== 'object') return node;
	const out: Record<string, unknown> = { ...node };
	for (const key of BAILEYS_MEDIA_BYTE_KEYS) {
		if (out[key] != null) {
			const buf = base64ToBuffer(out[key]);
			if (buf) out[key] = buf;
		}
	}
	return out;
}

/** Persist enough Baileys media fields to re-download after restart. */
export function sanitizeBaileysWaMessage(raw: any) {
	const source = raw?.protocol === 'baileys' ? raw : raw;
	if (!source?.key || !source?.message) return null;
	const content =
		source.message.ephemeralMessage?.message ||
		source.message.viewOnceMessage?.message ||
		source.message.viewOnceMessageV2?.message ||
		source.message.viewOnceMessageV2Extension?.message ||
		source.message;
	const hasMedia = Boolean(
		content.imageMessage ||
			content.videoMessage ||
			content.audioMessage ||
			content.documentMessage ||
			content.stickerMessage,
	);
	if (!hasMedia) {
		return {
			protocol: 'baileys',
			key: {
				remoteJid: source.key.remoteJid,
				id: source.key.id,
				fromMe: source.key.fromMe,
				participant: source.key.participant,
			},
			messageTimestamp: source.messageTimestamp,
		};
	}
	const message: Record<string, unknown> = {};
	if (content.imageMessage) message.imageMessage = sanitizeBaileysMediaNode(content.imageMessage);
	if (content.videoMessage) message.videoMessage = sanitizeBaileysMediaNode(content.videoMessage);
	if (content.audioMessage) message.audioMessage = sanitizeBaileysMediaNode(content.audioMessage);
	if (content.documentMessage) {
		message.documentMessage = sanitizeBaileysMediaNode(content.documentMessage);
	}
	if (content.stickerMessage) {
		message.stickerMessage = sanitizeBaileysMediaNode(content.stickerMessage);
	}
	if (source.message.ephemeralMessage) {
		return {
			protocol: 'baileys',
			key: {
				remoteJid: source.key.remoteJid,
				id: source.key.id,
				fromMe: source.key.fromMe,
				participant: source.key.participant,
			},
			messageTimestamp: source.messageTimestamp,
			message: { ephemeralMessage: { message } },
		};
	}
	return {
		protocol: 'baileys',
		key: {
			remoteJid: source.key.remoteJid,
			id: source.key.id,
			fromMe: source.key.fromMe,
			participant: source.key.participant,
		},
		messageTimestamp: source.messageTimestamp,
		message,
	};
}

export function reviveBaileysWaMessage(raw: any) {
	if (!raw?.message || !raw?.key) return null;
	if (raw.protocol && raw.protocol !== 'baileys') return null;
	const content =
		raw.message.ephemeralMessage?.message ||
		raw.message.viewOnceMessage?.message ||
		raw.message.viewOnceMessageV2?.message ||
		raw.message.viewOnceMessageV2Extension?.message ||
		raw.message;
	const revived: Record<string, unknown> = {};
	if (content.imageMessage) revived.imageMessage = reviveBaileysMediaNode(content.imageMessage);
	if (content.videoMessage) revived.videoMessage = reviveBaileysMediaNode(content.videoMessage);
	if (content.audioMessage) revived.audioMessage = reviveBaileysMediaNode(content.audioMessage);
	if (content.documentMessage) {
		revived.documentMessage = reviveBaileysMediaNode(content.documentMessage);
	}
	if (content.stickerMessage) revived.stickerMessage = reviveBaileysMediaNode(content.stickerMessage);
	if (!Object.keys(revived).length) return null;
	const message = raw.message.ephemeralMessage
		? { ephemeralMessage: { message: revived } }
		: revived;
	return {
		key: raw.key,
		messageTimestamp: raw.messageTimestamp,
		message,
	};
}
