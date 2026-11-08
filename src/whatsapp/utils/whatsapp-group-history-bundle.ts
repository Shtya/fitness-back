/**
 * "X sent you message history": when someone adds us to a group, WhatsApp can share the group's
 * recent messages as a `messageHistoryBundle`, a pointer to an encrypted blob. Baileys 7 does
 * not read it, so the chat only starts at the moment we joined.
 *
 * The format is not documented. What other clients report (whatsapp-rust on the sending side,
 * matchtime and whatsapp-mcp on the receiving side): an encrypted media blob, a zlib-compressed
 * protobuf inside, holding WebMessageInfo entries either as a GroupHistory list or as a
 * HistorySync. Nothing is guessed blindly here: every key candidate must pass the blob's own MAC,
 * every unpack/decode candidate must produce real message keys, and all work is bounded.
 */
import { createDecipheriv, createHash, createHmac, hkdfSync, timingSafeEqual } from 'crypto';
import { gunzipSync, inflateRawSync, inflateSync } from 'zlib';

/** HKDF info strings to try, most likely first. The MAC decides which one is right. */
export const GROUP_HISTORY_KEY_INFOS = [
	'Group History',
	'WhatsApp History Keys',
	'WhatsApp Document Keys',
	'WhatsApp App State Keys',
] as const;

export const GROUP_HISTORY_MEDIA_HOST = 'mmg.whatsapp.net';

export const GROUP_HISTORY_LIMITS = {
	/** Encrypted download (WhatsApp shares ~100 recent messages; this is far above that). */
	maxEncryptedBytes: 8 * 1024 * 1024,
	/** After inflate: a small download must not balloon (zip bombs). */
	maxPlainBytes: 24 * 1024 * 1024,
	/** Top-level protobuf entries looked at before giving up. */
	maxEntries: 5000,
	/** Messages kept from one bundle. */
	maxMessages: 2000,
	/** HistorySync conversations looked at. */
	maxConversations: 32,
	downloadTimeoutMs: 30_000,
} as const;

export type GroupHistoryBundlePointer = {
	directPath?: string | null;
	mediaKey?: Uint8Array | string | null;
	fileSha256?: Uint8Array | string | null;
	fileEncSha256?: Uint8Array | string | null;
	messageHistoryMetadata?: { messageCount?: unknown; oldestMessageTimestamp?: unknown } | null;
};

export type BundleProto = {
	WebMessageInfo: { decode(bytes: Uint8Array): any };
	HistorySync: { decode(bytes: Uint8Array): any };
	HistorySyncMsg?: { decode(bytes: Uint8Array): any };
};

function toBuffer(value: Uint8Array | string | null | undefined): Buffer | null {
	if (!value) return null;
	if (typeof value === 'string') {
		const buf = Buffer.from(value, 'base64');
		return buf.length ? buf : null;
	}
	return Buffer.from(value);
}

function sameBytes(a: Buffer, b: Buffer) {
	return a.length === b.length && timingSafeEqual(a, b);
}

/** A safe media path: absolute, no host, no backslashes or whitespace. */
export function isSafeDirectPath(directPath: unknown): directPath is string {
	return typeof directPath === 'string' && /^\/[^/\\\s][^\\\s]*$/.test(directPath) && directPath.length < 2048;
}

/**
 * Decrypt a WhatsApp media blob (AES-256-CBC + truncated HMAC) trying each HKDF info until one
 * passes the MAC. Throws when none does, or when a supplied hash does not match.
 */
export function decryptGroupHistoryBlob(
	encrypted: Buffer,
	pointer: Pick<GroupHistoryBundlePointer, 'mediaKey' | 'fileSha256' | 'fileEncSha256'>,
	infos: readonly string[] = GROUP_HISTORY_KEY_INFOS,
): { plain: Buffer; info: string } {
	const mediaKey = toBuffer(pointer.mediaKey);
	if (!mediaKey || mediaKey.length !== 32) throw new Error('bundle has no usable media key');
	if (encrypted.length <= 10 + 16) throw new Error('bundle download is too short');
	const encSha = toBuffer(pointer.fileEncSha256);
	if (encSha && !sameBytes(createHash('sha256').update(encrypted).digest(), encSha)) {
		throw new Error('bundle download does not match its hash');
	}
	const body = encrypted.subarray(0, encrypted.length - 10);
	const mac = encrypted.subarray(encrypted.length - 10);
	for (const info of infos) {
		const expanded = Buffer.from(hkdfSync('sha256', mediaKey, Buffer.alloc(0), info, 112));
		const iv = expanded.subarray(0, 16);
		const cipherKey = expanded.subarray(16, 48);
		const macKey = expanded.subarray(48, 80);
		const expected = createHmac('sha256', macKey).update(iv).update(body).digest().subarray(0, 10);
		if (!sameBytes(expected, mac)) continue;
		const decipher = createDecipheriv('aes-256-cbc', cipherKey, iv);
		const plain = Buffer.concat([decipher.update(body), decipher.final()]);
		const plainSha = toBuffer(pointer.fileSha256);
		if (plainSha && !sameBytes(createHash('sha256').update(plain).digest(), plainSha)) {
			throw new Error('bundle content does not match its hash');
		}
		return { plain, info };
	}
	throw new Error('no key derivation matched the bundle MAC');
}

/** The ways the decrypted bytes may be packed, bounded against inflate bombs. */
export function unpackCandidates(plain: Buffer, maxOutputLength: number = GROUP_HISTORY_LIMITS.maxPlainBytes) {
	const out: { label: string; bytes: Buffer }[] = [];
	const tryOne = (label: string, fn: () => Buffer) => {
		try {
			out.push({ label, bytes: fn() });
		} catch {
			// not this packing
		}
	};
	tryOne('zlib', () => inflateSync(plain, { maxOutputLength }));
	tryOne('gzip', () => gunzipSync(plain, { maxOutputLength }));
	tryOne('raw-deflate', () => inflateRawSync(plain, { maxOutputLength }));
	if (plain.length <= maxOutputLength) out.push({ label: 'plain', bytes: plain });
	return out;
}

type Field = { field: number; wire: number; start: number; end: number };

/**
 * Top-level fields of a protobuf message, without decoding them. Stops (returns null) on
 * malformed input or past `maxEntries`, so a hostile blob costs at most one linear scan.
 */
export function topLevelFields(bytes: Uint8Array, maxEntries: number = GROUP_HISTORY_LIMITS.maxEntries): Field[] | null {
	const fields: Field[] = [];
	let pos = 0;
	const varint = (): number | null => {
		let result = 0;
		let shift = 0;
		while (pos < bytes.length && shift < 64) {
			const b = bytes[pos++];
			if (shift < 49) result += (b & 0x7f) * 2 ** shift;
			if (!(b & 0x80)) return result;
			shift += 7;
		}
		return null;
	};
	while (pos < bytes.length) {
		if (fields.length >= maxEntries) return null;
		const key = varint();
		if (key == null || key === 0) return null;
		const field = Math.floor(key / 8);
		const wire = key % 8;
		const start = pos;
		if (wire === 0) {
			if (varint() == null) return null;
		} else if (wire === 1) {
			pos += 8;
		} else if (wire === 2) {
			const len = varint();
			if (len == null || pos + len > bytes.length) return null;
			const valueStart = pos;
			pos += len;
			fields.push({ field, wire, start: valueStart, end: pos });
			continue;
		} else if (wire === 5) {
			pos += 4;
		} else {
			return null;
		}
		if (pos > bytes.length) return null;
		fields.push({ field, wire, start, end: pos });
	}
	return fields;
}

const PLAUSIBLE_ID = /^[0-9A-Za-z._:-]{6,80}$/;

function plausibleMessage(info: any) {
	const id = String(info?.key?.id || '');
	return PLAUSIBLE_ID.test(id) && Boolean(info?.message || info?.messageStubType);
}

function decodeEach(bytes: Buffer, fields: Field[], numbers: number[], decode: (b: Uint8Array) => any) {
	const out: any[] = [];
	for (const f of fields) {
		if (f.wire !== 2 || !numbers.includes(f.field)) continue;
		try {
			out.push(decode(bytes.subarray(f.start, f.end)));
		} catch {
			return null;
		}
	}
	return out;
}

/**
 * The WebMessageInfo entries in an unpacked bundle. Tries, in order:
 * - GroupHistory: `repeated WebMessageInfo messages = 1; repeated WebMessageInfo pinned = 4;`
 * - HistorySync: `conversations[].messages[].message`
 * - a bare list of HistorySyncMsg (field 1, each with `.message`)
 * A layout only counts when most of what it yields looks like real messages.
 */
export function decodeBundleMessages(bytes: Buffer, proto: BundleProto): { layout: string; messages: any[] } | null {
	const fields = topLevelFields(bytes);
	if (!fields || !fields.length) return null;
	const accept = (layout: string, list: any[] | null) => {
		if (!list || !list.length) return null;
		const good = list.filter(plausibleMessage);
		return good.length >= Math.ceil(list.length * 0.6) ? { layout, messages: good } : null;
	};
	const asGroupHistory = accept('group-history', decodeEach(bytes, fields, [1, 4], b => proto.WebMessageInfo.decode(b)));
	if (asGroupHistory) return asGroupHistory;
	try {
		const sync = proto.HistorySync.decode(bytes);
		const conversations = Array.isArray(sync?.conversations)
			? sync.conversations.slice(0, GROUP_HISTORY_LIMITS.maxConversations)
			: [];
		const list = conversations.flatMap((c: any) =>
			(Array.isArray(c?.messages) ? c.messages : []).map((m: any) => m?.message).filter(Boolean),
		);
		const asSync = accept('history-sync', list);
		if (asSync) return asSync;
	} catch {
		// not a HistorySync
	}
	if (proto.HistorySyncMsg) {
		const list = decodeEach(bytes, fields, [1], b => proto.HistorySyncMsg!.decode(b)?.message);
		const asMsgList = accept('history-sync-msgs', list ? list.filter(Boolean) : null);
		if (asMsgList) return asMsgList;
	}
	return null;
}

function bareJid(value: unknown) {
	const raw = String(value || '').trim().toLowerCase();
	if (!raw.includes('@')) return raw;
	const [user, server] = raw.split('@');
	return `${user.split(':')[0]}@${server}`;
}

/**
 * Messages as they belong in this group, from our point of view:
 * - only this group's messages (others are dropped), keyed to the group;
 * - "fromMe" in the bundle means the sharer, unless the sender is one of our own ids;
 * - one entry per id, oldest first, capped.
 */
export function prepareBundleMessages(
	messages: any[],
	options: { groupJid: string; sharerJid?: string | null; ownJids?: string[]; maxMessages?: number },
) {
	const group = bareJid(options.groupJid);
	const own = new Set((options.ownJids || []).map(bareJid));
	const sharer = options.sharerJid ? String(options.sharerJid) : null;
	const seen = new Set<string>();
	const out: any[] = [];
	for (const info of messages) {
		const key = info?.key || {};
		const id = String(key.id || '');
		if (!id || seen.has(id)) continue;
		const remote = key.remoteJid ? bareJid(key.remoteJid) : group;
		if (remote !== group) continue;
		seen.add(id);
		let participant = key.participant || info.participant || null;
		if (!participant && key.fromMe && sharer) participant = sharer;
		const fromMe = Boolean(participant && own.has(bareJid(participant)));
		out.push({
			...info,
			key: { ...key, remoteJid: options.groupJid, fromMe, participant: participant || undefined },
			participant: participant || info.participant || undefined,
		});
	}
	// messageTimestamp may be a number or a protobuf Long
	const ts = (m: any) => Number(String(m?.messageTimestamp ?? 0)) || 0;
	out.sort((a, b) => ts(a) - ts(b));
	const max = options.maxMessages ?? GROUP_HISTORY_LIMITS.maxMessages;
	return out.length > max ? out.slice(out.length - max) : out;
}

/** Download the encrypted blob, bounded in size and time, never following redirects. */
export async function downloadGroupHistoryBlob(
	directPath: string,
	options: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
	if (!isSafeDirectPath(directPath)) throw new Error('bundle has no safe media path');
	const fetchImpl = options.fetchImpl || fetch;
	const maxBytes = options.maxBytes ?? GROUP_HISTORY_LIMITS.maxEncryptedBytes;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? GROUP_HISTORY_LIMITS.downloadTimeoutMs);
	try {
		const res = await fetchImpl(`https://${GROUP_HISTORY_MEDIA_HOST}${directPath}`, {
			headers: { Origin: 'https://web.whatsapp.com' },
			signal: controller.signal,
			redirect: 'error',
		});
		if (!res.ok) throw new Error(`bundle download failed: HTTP ${res.status}`);
		const declared = Number(res.headers.get('content-length') || 0);
		if (declared > maxBytes) throw new Error('bundle is too large');
		const chunks: Buffer[] = [];
		let total = 0;
		const reader = res.body?.getReader();
		if (!reader) return Buffer.from(await res.arrayBuffer());
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.length;
			if (total > maxBytes) {
				controller.abort();
				throw new Error('bundle is too large');
			}
			chunks.push(Buffer.from(value));
		}
		return Buffer.concat(chunks);
	} finally {
		clearTimeout(timer);
	}
}

/** Download, decrypt, unpack and decode one bundle. */
export async function readGroupHistoryBundle(
	pointer: GroupHistoryBundlePointer,
	proto: BundleProto,
	options: { fetchImpl?: typeof fetch } = {},
) {
	const count = Number((pointer.messageHistoryMetadata as any)?.messageCount ?? 0);
	if (count > GROUP_HISTORY_LIMITS.maxEntries) throw new Error(`bundle declares too many messages (${count})`);
	const encrypted = await downloadGroupHistoryBlob(String(pointer.directPath || ''), options);
	const { plain, info } = decryptGroupHistoryBlob(encrypted, pointer);
	for (const candidate of unpackCandidates(plain)) {
		const decoded = decodeBundleMessages(candidate.bytes, proto);
		if (decoded) return { ...decoded, keyInfo: info, packing: candidate.label };
	}
	throw new Error('bundle content is not a message list this client understands');
}
