import { toCoord } from './whatsapp-location';

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

function unwrapBaileysContent(message: any): any {
	if (!message || typeof message !== 'object') return message;
	return (
		message.ephemeralMessage?.message ||
		message.viewOnceMessage?.message ||
		message.viewOnceMessageV2?.message ||
		message.viewOnceMessageV2Extension?.message ||
		message.documentWithCaptionMessage?.message ||
		message.editedMessage?.message ||
		message
	);
}

function contextInfoOf(content: any) {
	if (!content || typeof content !== 'object') return null;
	return (
		content.extendedTextMessage?.contextInfo ||
		content.imageMessage?.contextInfo ||
		content.videoMessage?.contextInfo ||
		content.audioMessage?.contextInfo ||
		content.documentMessage?.contextInfo ||
		content.stickerMessage?.contextInfo ||
		content.locationMessage?.contextInfo ||
		content.liveLocationMessage?.contextInfo ||
		null
	);
}

function sanitizeQuotedMessage(quoted: any) {
	const content = unwrapBaileysContent(quoted);
	if (!content || typeof content !== 'object') return undefined;
	const out: Record<string, unknown> = {};
	if (typeof content.conversation === 'string') out.conversation = content.conversation;
	if (typeof content.extendedTextMessage?.text === 'string') {
		out.extendedTextMessage = { text: content.extendedTextMessage.text };
	}
	const mediaKeys = [
		'imageMessage',
		'videoMessage',
		'stickerMessage',
		'documentMessage',
	] as const;
	for (const key of mediaKeys) {
		const node = content[key];
		if (!node || typeof node !== 'object') continue;
		const jpegThumbnail = bytesToBase64(node.jpegThumbnail);
		out[key] = {
			...(typeof node.caption === 'string' ? { caption: node.caption } : {}),
			...(typeof node.mimetype === 'string' ? { mimetype: node.mimetype } : {}),
			...(jpegThumbnail ? { jpegThumbnail } : {}),
		};
	}
	if (content.locationMessage) {
		const location = sanitizeLocationNode(content.locationMessage, false);
		if (location) out.locationMessage = location;
	}
	if (content.liveLocationMessage) {
		const location = sanitizeLocationNode(content.liveLocationMessage, false);
		if (location) out.liveLocationMessage = location;
	}
	return Object.keys(out).length ? out : undefined;
}

function sanitizeLocationNode(node: any, withContext = true) {
	if (!node || typeof node !== 'object') return null;
	const jpegThumbnail = bytesToBase64(node.jpegThumbnail);
	const contextInfo = withContext ? sanitizeContextInfo(node.contextInfo) : undefined;
	const out: Record<string, unknown> = {};
	const latitude = toCoord(node.degreesLatitude ?? node.latitude ?? node.lat);
	const longitude = toCoord(node.degreesLongitude ?? node.longitude ?? node.lng ?? node.lon);
	if (latitude != null) out.degreesLatitude = latitude;
	if (longitude != null) out.degreesLongitude = longitude;
	if (typeof node.name === 'string') out.name = node.name;
	if (typeof node.address === 'string') out.address = node.address;
	if (typeof node.comment === 'string') out.comment = node.comment;
	if (typeof node.caption === 'string') out.caption = node.caption;
	if (typeof node.url === 'string') out.url = node.url;
	if (jpegThumbnail) out.jpegThumbnail = jpegThumbnail;
	if (contextInfo) out.contextInfo = contextInfo;
	return Object.keys(out).length ? out : null;
}

function sanitizeContextInfo(info: any) {
	if (!info || typeof info !== 'object') return undefined;
	const quotedMessage = sanitizeQuotedMessage(info.quotedMessage);
	const mentionedJid = Array.isArray(info.mentionedJid)
		? info.mentionedJid.filter((item: unknown) => typeof item === 'string' && item)
		: undefined;
	const out: Record<string, unknown> = {};
	if (info.stanzaId) out.stanzaId = info.stanzaId;
	if (info.participant) out.participant = info.participant;
	if (mentionedJid?.length) out.mentionedJid = mentionedJid;
	if (info.isForwarded) out.isForwarded = true;
	if (Number(info.forwardingScore) > 0) out.forwardingScore = Number(info.forwardingScore);
	if (quotedMessage) out.quotedMessage = quotedMessage;
	return Object.keys(out).length ? out : undefined;
}

function sanitizeBaileysMediaNode(node: any) {
	if (!node || typeof node !== 'object') return null;
	const out: Record<string, unknown> = { ...node };
	for (const key of BAILEYS_MEDIA_BYTE_KEYS) {
		if (out[key] != null) {
			const encoded = bytesToBase64(out[key]);
			if (encoded) out[key] = encoded;
		}
	}
	if (out.contextInfo) {
		const contextInfo = sanitizeContextInfo(out.contextInfo);
		if (contextInfo) out.contextInfo = contextInfo;
		else delete out.contextInfo;
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

function baileysEnvelope(source: any, message?: Record<string, unknown>) {
	return {
		protocol: 'baileys',
		key: {
			remoteJid: source.key.remoteJid,
			id: source.key.id,
			fromMe: source.key.fromMe,
			participant: source.key.participant,
		},
		messageTimestamp: source.messageTimestamp,
		...(source.pushName ? { pushName: source.pushName } : {}),
		...(message && Object.keys(message).length ? { message } : {}),
	};
}

/** Persist enough Baileys media fields to re-download after restart. */
export function sanitizeBaileysWaMessage(raw: any) {
	const source = raw?.protocol === 'baileys' ? raw : raw;
	if (!source?.key || !source?.message) return null;
	const content = unwrapBaileysContent(source.message);
	const hasMedia = Boolean(
		content.imageMessage ||
			content.videoMessage ||
			content.audioMessage ||
			content.documentMessage ||
			content.stickerMessage,
	);
	if (!hasMedia) {
		const locationMessage = content.locationMessage
			? sanitizeLocationNode(content.locationMessage)
			: null;
		const liveLocationMessage = content.liveLocationMessage
			? sanitizeLocationNode(content.liveLocationMessage)
			: null;
		if (locationMessage || liveLocationMessage) {
			const message: Record<string, unknown> = {
				...(locationMessage ? { locationMessage } : {}),
				...(liveLocationMessage ? { liveLocationMessage } : {}),
			};
			if (source.message.ephemeralMessage) {
				return baileysEnvelope(source, { ephemeralMessage: { message } });
			}
			return baileysEnvelope(source, message);
		}
		const contactMessage = content.contactMessage
			? {
					displayName: content.contactMessage.displayName,
					vcard: content.contactMessage.vcard,
				}
			: null;
		const contactsArrayMessage = content.contactsArrayMessage
			? {
					displayName: content.contactsArrayMessage.displayName,
					contacts: (content.contactsArrayMessage.contacts || []).map((entry: any) => ({
						displayName: entry?.displayName,
						vcard: entry?.vcard,
					})),
				}
			: null;
		if (contactMessage || contactsArrayMessage) {
			const message: Record<string, unknown> = {
				...(contactMessage ? { contactMessage } : {}),
				...(contactsArrayMessage ? { contactsArrayMessage } : {}),
			};
			if (source.message.ephemeralMessage) {
				return baileysEnvelope(source, { ephemeralMessage: { message } });
			}
			return baileysEnvelope(source, message);
		}
		const contextInfo = sanitizeContextInfo(contextInfoOf(content));
		const message: Record<string, unknown> = {};
		if (content.extendedTextMessage) {
			message.extendedTextMessage = {
				...(typeof content.extendedTextMessage.text === 'string'
					? { text: content.extendedTextMessage.text }
					: {}),
				...(contextInfo ? { contextInfo } : {}),
			};
		} else if (typeof content.conversation === 'string') {
			message.conversation = content.conversation;
			if (contextInfo) {
				message.extendedTextMessage = {
					text: content.conversation,
					contextInfo,
				};
			}
		} else if (contextInfo) {
			message.extendedTextMessage = { contextInfo };
		}
		return baileysEnvelope(source, message);
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
		return baileysEnvelope(source, { ephemeralMessage: { message } });
	}
	return baileysEnvelope(source, message);
}

export function reviveBaileysWaMessage(raw: any) {
	if (!raw?.message || !raw?.key) return null;
	if (raw.protocol && raw.protocol !== 'baileys') return null;
	const content = unwrapBaileysContent(raw.message);
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
		...(raw.pushName ? { pushName: raw.pushName } : {}),
	};
}
