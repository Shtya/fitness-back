export interface HeldReceiptKey {
	remoteJid: string;
	id: string;
	participant?: string;
}

interface Bucket {
	aliases: Set<string>;
	keys: Map<string, HeldReceiptKey>;
}

/**
 * Incoming messages whose "delivered" receipt was held back, grouped per chat.
 * A chat can be addressed by several ids (phone JID, @c.us, @lid), so every alias points to the
 * same bucket. Bounded so a long-running session cannot grow without limit.
 */
export class HeldDeliveryReceipts {
	private readonly byAlias = new Map<string, Bucket>();
	private readonly buckets = new Set<Bucket>();

	constructor(
		private readonly normalize: (jid: string) => string[] = jid => [jid],
		private readonly perChatLimit = 100,
		private readonly chatLimit = 3000,
	) {}

	private aliasesOf(ids: Array<string | null | undefined>) {
		const out = new Set<string>();
		for (const id of ids) {
			const raw = String(id || '').trim();
			if (!raw) continue;
			for (const alias of this.normalize(raw)) if (alias) out.add(alias);
		}
		return out;
	}

	private find(aliases: Set<string>) {
		for (const alias of aliases) {
			const bucket = this.byAlias.get(alias);
			if (bucket) return bucket;
		}
		return null;
	}

	private remove(bucket: Bucket) {
		for (const alias of bucket.aliases) {
			if (this.byAlias.get(alias) === bucket) this.byAlias.delete(alias);
		}
		this.buckets.delete(bucket);
	}

	hold(key: HeldReceiptKey, chatAliases: Array<string | null | undefined> = []) {
		if (!key?.remoteJid || !key?.id) return;
		const aliases = this.aliasesOf([key.remoteJid, ...chatAliases]);
		let bucket = this.find(aliases);
		if (!bucket) {
			if (this.buckets.size >= this.chatLimit) {
				const oldest = this.buckets.values().next().value;
				if (oldest) this.remove(oldest);
			}
			bucket = { aliases: new Set(), keys: new Map() };
			this.buckets.add(bucket);
		}
		for (const alias of aliases) {
			bucket.aliases.add(alias);
			this.byAlias.set(alias, bucket);
		}
		bucket.keys.delete(key.id);
		bucket.keys.set(key.id, { remoteJid: key.remoteJid, id: key.id, participant: key.participant || undefined });
		while (bucket.keys.size > this.perChatLimit) {
			const first = bucket.keys.keys().next().value;
			if (first === undefined) break;
			bucket.keys.delete(first);
		}
	}

	/** Removes and returns the held keys of a chat. */
	take(chatIds: Array<string | null | undefined>): HeldReceiptKey[] {
		const bucket = this.find(this.aliasesOf(chatIds));
		if (!bucket) return [];
		this.remove(bucket);
		return [...bucket.keys.values()];
	}

	count(chatIds: Array<string | null | undefined>) {
		return this.find(this.aliasesOf(chatIds))?.keys.size || 0;
	}
}
