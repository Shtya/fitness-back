/**
 * Sender keys under both of a person's addresses (phone number and LID).
 *
 * Stories (status@broadcast) and group messages are encrypted with the sender's "sender key".
 * Baileys stores the key it receives under the exact address the stanza carried it with, e.g.
 * `status@broadcast::201001234567::0` (phone) or `status@broadcast::123456789012345_1::0` (LID),
 * and looks it up the same way, without mapping LID <-> phone (1:1 sessions do map; sender keys
 * do not, in Baileys 7.0.0-rc14 and in no merged upstream change).
 *
 * WhatsApp has been moving people from phone-number to LID addressing. Someone whose key reached
 * us while they were addressed by phone, and whose stories now arrive addressed by LID (or the
 * other way round), fails every time with "No SenderKeyRecord found for decryption": their phone
 * believes we hold the key and does not send it again. That is "stories of some people never
 * arrive, others do".
 *
 * This wraps the key store: a sender key missing under one address is read from the other, and
 * a sender key written under one address is written under both.
 */

/** WhatsApp JID domains as Baileys encodes them in a Signal address (`user_<domain>`). */
const DOMAIN = { PN: 0, LID: 1, HOSTED_PN: 128, HOSTED_LID: 129 } as const;

export type SenderKeyIdParts = { group: string; user: string; domain: number; device: string };

/** `group::user[_domain]::device` → parts; null for anything else. */
export function parseSenderKeyId(id: string): SenderKeyIdParts | null {
	const parts = String(id || '').split('::');
	if (parts.length !== 3) return null;
	const [group, address, device] = parts;
	const match = /^(\d+)(?:_(\d+))?$/.exec(address);
	if (!group || !match || !/^\d+$/.test(device)) return null;
	return { group, user: match[1], domain: Number(match[2] || 0), device };
}

export function buildSenderKeyId({ group, user, domain, device }: SenderKeyIdParts): string {
	return `${group}::${domain ? `${user}_${domain}` : user}::${device}`;
}

function isLidDomain(domain: number) {
	return domain === DOMAIN.LID || domain === DOMAIN.HOSTED_LID;
}

function isPnDomain(domain: number) {
	return domain === DOMAIN.PN || domain === DOMAIN.HOSTED_PN;
}

type KeyStore = {
	get: (type: string, ids: string[]) => Promise<Record<string, any>>;
	set: (data: Record<string, Record<string, any>>) => Promise<void>;
	[extra: string]: any;
};

/**
 * The other address of each sender-key id, using Baileys' own `lid-mapping` keys
 * (`<phoneUser>` → `<lidUser>`, `<lidUser>_reverse` → `<phoneUser>`).
 */
export async function alternateSenderKeyIds(
	ids: string[],
	readMapping: (keys: string[]) => Promise<Record<string, any>>,
): Promise<Map<string, string>> {
	const parsed = ids
		.map((id) => ({ id, parts: parseSenderKeyId(id) }))
		.filter((item): item is { id: string; parts: SenderKeyIdParts } => Boolean(item.parts));
	if (!parsed.length) return new Map();
	const mappingKeys = [
		...new Set(
			parsed.map(({ parts }) => (isLidDomain(parts.domain) ? `${parts.user}_reverse` : parts.user)),
		),
	];
	const mapping = (await readMapping(mappingKeys).catch(() => ({}))) || {};
	const out = new Map<string, string>();
	for (const { id, parts } of parsed) {
		if (isPnDomain(parts.domain)) {
			const lidUser = String(mapping[parts.user] || '').trim();
			if (!/^\d+$/.test(lidUser)) continue;
			const domain = parts.domain === DOMAIN.HOSTED_PN ? DOMAIN.HOSTED_LID : DOMAIN.LID;
			out.set(id, buildSenderKeyId({ ...parts, user: lidUser, domain }));
		} else if (isLidDomain(parts.domain)) {
			const pnUser = String(mapping[`${parts.user}_reverse`] || '').trim();
			if (!/^\d+$/.test(pnUser)) continue;
			const domain = parts.domain === DOMAIN.HOSTED_LID ? DOMAIN.HOSTED_PN : DOMAIN.PN;
			out.set(id, buildSenderKeyId({ ...parts, user: pnUser, domain }));
		}
	}
	return out;
}

/**
 * Wraps a Baileys SignalKeyStore in place. `onFallback(requestedId, foundUnderId)` is called each
 * time a sender key was only found under the person's other address.
 */
export function withSenderKeyAliases<T extends KeyStore>(
	keys: T,
	onFallback?: (requestedId: string, foundUnderId: string) => void,
): T {
	const rawGet = keys.get.bind(keys);
	const rawSet = keys.set.bind(keys);
	const readMapping = (mappingKeys: string[]) => rawGet('lid-mapping', mappingKeys);

	keys.get = async (type: string, ids: string[]) => {
		const result = (await rawGet(type, ids)) || {};
		if (type !== 'sender-key') return result;
		const missing = ids.filter((id) => !result[id]);
		if (!missing.length) return result;
		const alternates = await alternateSenderKeyIds(missing, readMapping);
		if (!alternates.size) return result;
		const found = (await rawGet('sender-key', [...new Set(alternates.values())])) || {};
		for (const [id, alternate] of alternates) {
			if (!found[alternate]) continue;
			result[id] = found[alternate];
			onFallback?.(id, alternate);
		}
		return result;
	};

	keys.set = async (data: Record<string, Record<string, any>>) => {
		const senderKeys = data?.['sender-key'];
		if (!senderKeys || typeof senderKeys !== 'object') return rawSet(data);
		const ids = Object.keys(senderKeys);
		const alternates = await alternateSenderKeyIds(ids, readMapping);
		if (!alternates.size) return rawSet(data);
		// Same value (or deletion) under the other address too, so both stay the same key state.
		const merged: Record<string, any> = { ...senderKeys };
		for (const [id, alternate] of alternates) {
			if (!(alternate in senderKeys)) merged[alternate] = senderKeys[id];
		}
		return rawSet({ ...data, 'sender-key': merged });
	};

	return keys;
}
