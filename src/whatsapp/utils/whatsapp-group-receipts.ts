export interface GroupReceiptMemberInput {
	key: string;
	name?: string | null;
	phone?: string | null;
	avatarUrl?: string | null;
}

export interface GroupReceiptInput {
	participantKey: string;
	deliveredAt?: Date | null;
	readAt?: Date | null;
	playedAt?: Date | null;
}

export interface GroupReceiptEntry {
	key: string;
	name: string | null;
	phone: string | null;
	avatarUrl: string | null;
	deliveredAt: Date | null;
	readAt: Date | null;
	playedAt: Date | null;
}

export interface GroupReceiptView {
	total: number;
	read: GroupReceiptEntry[];
	delivered: GroupReceiptEntry[];
	remaining: GroupReceiptEntry[];
	/** False when no member receipt was ever stored for this message. */
	tracked: boolean;
}

/** `1234:5@s.whatsapp.net` → `1234@s.whatsapp.net` (drop device suffix). */
export function whatsAppReceiptBaseKey(key: string): string {
	const raw = String(key || '').trim().toLowerCase();
	const [user, server] = raw.split('@');
	const bare = String(user || '').split(':')[0];
	return server ? `${bare}@${server}` : bare;
}

function earliest(a: Date | null | undefined, b: Date | null | undefined): Date | null {
	const left = a instanceof Date && !Number.isNaN(a.getTime()) ? a : null;
	const right = b instanceof Date && !Number.isNaN(b.getTime()) ? b : null;
	if (!left) return right;
	if (!right) return left;
	return left.getTime() <= right.getTime() ? left : right;
}

/**
 * Splits group members into read / delivered-only / remaining, WhatsApp style.
 * `identityOf` maps any member or receipt key (phone JID or LID) to one canonical
 * identity so a LID receipt still matches a phone-JID participant row.
 */
export function buildWhatsAppGroupReceiptView(input: {
	members: GroupReceiptMemberInput[];
	receipts: GroupReceiptInput[];
	selfIdentities: Iterable<string>;
	identityOf: (key: string) => string;
	describe?: (key: string) => Omit<GroupReceiptMemberInput, 'key'> | undefined;
}): GroupReceiptView {
	const self = new Set([...input.selfIdentities].filter(Boolean));
	const entries = new Map<string, GroupReceiptEntry>();
	const ensure = (key: string, info?: Omit<GroupReceiptMemberInput, 'key'>) => {
		const identity = input.identityOf(key);
		if (!identity || self.has(identity)) return null;
		let entry = entries.get(identity);
		if (!entry) {
			entry = {
				key,
				name: null,
				phone: null,
				avatarUrl: null,
				deliveredAt: null,
				readAt: null,
				playedAt: null,
			};
			entries.set(identity, entry);
		}
		const details = info || input.describe?.(key);
		if (details) {
			entry.name = entry.name || details.name || null;
			entry.phone = entry.phone || details.phone || null;
			entry.avatarUrl = entry.avatarUrl || details.avatarUrl || null;
		}
		return entry;
	};

	for (const member of input.members || []) {
		if (!member?.key) continue;
		ensure(member.key, member);
	}
	let tracked = false;
	for (const receipt of input.receipts || []) {
		if (!receipt?.participantKey) continue;
		tracked = true;
		const entry = ensure(receipt.participantKey);
		if (!entry) continue;
		entry.deliveredAt = earliest(entry.deliveredAt, receipt.deliveredAt);
		entry.readAt = earliest(entry.readAt, receipt.readAt);
		entry.playedAt = earliest(entry.playedAt, receipt.playedAt);
	}

	const read: GroupReceiptEntry[] = [];
	const delivered: GroupReceiptEntry[] = [];
	const remaining: GroupReceiptEntry[] = [];
	for (const entry of entries.values()) {
		const readAt = entry.readAt || entry.playedAt;
		if (readAt) {
			read.push({ ...entry, readAt, deliveredAt: entry.deliveredAt || readAt });
		} else if (entry.deliveredAt) {
			delivered.push(entry);
		} else {
			remaining.push(entry);
		}
	}
	const byTime = (field: 'readAt' | 'deliveredAt') => (a: GroupReceiptEntry, b: GroupReceiptEntry) =>
		(b[field]?.getTime() || 0) - (a[field]?.getTime() || 0);
	read.sort(byTime('readAt'));
	delivered.sort(byTime('deliveredAt'));
	remaining.sort((a, b) =>
		String(a.name || a.phone || a.key).localeCompare(String(b.name || b.phone || b.key)),
	);
	return { total: entries.size, read, delivered, remaining, tracked };
}
