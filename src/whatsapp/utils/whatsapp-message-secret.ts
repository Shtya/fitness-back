import { createDecipheriv, hkdfSync } from 'crypto';

/**
 * WhatsApp "secret encrypted" message modifications (edits sent as `secretEncryptedMessage`).
 * Key = HKDF-SHA256(original messageSecret, salt = none,
 *                   info = origMsgId + origSender + modificationSender + useCase), 32 bytes.
 * Payload = AES-256-GCM, auth tag appended. Same scheme Baileys uses for poll votes.
 */
export const WA_SECRET_USE_CASE_MESSAGE_EDIT = 'Message Edit';
/** proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT */
export const WA_SECRET_ENC_TYPE_MESSAGE_EDIT = 2;

/** Bytes from a Buffer / Uint8Array / base64 string / JSON-serialized Buffer. */
export function waSecretBytes(value: unknown): Buffer | null {
	if (!value) return null;
	if (Buffer.isBuffer(value)) return value.length ? value : null;
	if (value instanceof Uint8Array) return value.length ? Buffer.from(value) : null;
	if (typeof value === 'string') {
		const buf = Buffer.from(value, 'base64');
		return buf.length ? buf : null;
	}
	if (typeof value === 'object') {
		const data = (value as any).type === 'Buffer' ? (value as any).data : null;
		if (Array.isArray(data)) return data.length ? Buffer.from(data) : null;
		const keys = Object.keys(value as object);
		if (keys.length && keys.every((key) => /^\d+$/.test(key))) {
			return Buffer.from(keys.map((key) => Number((value as any)[key])));
		}
	}
	return null;
}

/** "user:device@server" → "user@server"; @c.us → @s.whatsapp.net (protocol form). */
export function waNonAdJid(jid: unknown): string {
	const raw = String(jid || '').trim();
	if (!raw || !raw.includes('@')) return '';
	const [userPart, serverPart] = raw.split('@');
	const user = String(userPart || '').split(':')[0].split('_')[0];
	const server = serverPart === 'c.us' ? 's.whatsapp.net' : serverPart;
	return user && server ? `${user}@${server}` : '';
}

/** messageContextInfo.messageSecret, wherever the content is wrapped. */
export function findWaMessageSecret(message: any, depth = 0): Buffer | null {
	if (!message || typeof message !== 'object' || depth > 5) return null;
	const direct = waSecretBytes(message.messageContextInfo?.messageSecret);
	if (direct) return direct;
	for (const key of [
		'ephemeralMessage',
		'viewOnceMessage',
		'viewOnceMessageV2',
		'viewOnceMessageV2Extension',
		'documentWithCaptionMessage',
		'editedMessage',
		'deviceSentMessage',
	]) {
		const nested = findWaMessageSecret(message[key]?.message, depth + 1);
		if (nested) return nested;
	}
	return null;
}

export function waMessageSecretKey(
	secret: Buffer,
	origMsgId: string,
	origSender: string,
	modificationSender: string,
	useCase: string,
): Buffer {
	const info = Buffer.from(
		`${origMsgId}${waNonAdJid(origSender)}${waNonAdJid(modificationSender)}${useCase}`,
		'utf8',
	);
	return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
}

function gcmDecrypt(key: Buffer, iv: Buffer, payload: Buffer, aad: Buffer | null): Buffer | null {
	if (payload.length <= 16) return null;
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		if (aad) decipher.setAAD(aad);
		decipher.setAuthTag(payload.subarray(payload.length - 16));
		return Buffer.concat([decipher.update(payload.subarray(0, payload.length - 16)), decipher.final()]);
	} catch {
		return null;
	}
}

/**
 * Tries every known form of the author's jid (LID / phone, with and without device);
 * the GCM tag only verifies for the right one. Returns the decrypted protobuf bytes.
 */
export function decryptWaSecretEncryptedPayload(input: {
	secret: Buffer;
	origMsgId: string;
	origSenders: string[];
	modificationSenders: string[];
	encPayload: Buffer;
	encIv: Buffer;
	useCase?: string;
}): Buffer | null {
	const useCase = input.useCase || WA_SECRET_USE_CASE_MESSAGE_EDIT;
	const uniq = (list: string[]) => [...new Set(list.map(waNonAdJid).filter(Boolean))];
	const origSenders = uniq(input.origSenders);
	const modificationSenders = uniq(input.modificationSenders);
	for (const orig of origSenders) {
		for (const modifier of modificationSenders) {
			const key = waMessageSecretKey(input.secret, input.origMsgId, orig, modifier, useCase);
			const aads: Array<Buffer | null> = [null, Buffer.from(`${input.origMsgId}\u0000${modifier}`)];
			for (const aad of aads) {
				const plain = gcmDecrypt(key, input.encIv, input.encPayload, aad);
				if (plain) return plain;
			}
		}
	}
	return null;
}
