import { statusMessageKey } from './whatsapp-status-interactions';

/**
 * Who posted a story, and one row per story.
 *
 * A story posted from the phone used to be stored as a contact's: Baileys only recognised
 * our phone JID as "us" on status@broadcast, and those stories arrive under our LID. The
 * provider now fixes that on arrival; these helpers keep rows already stored that way (and
 * any that slip through) attributed to us, using every id we have: phone JID, LID, the
 * account's phone number.
 */

/** The user part of a JID ("2010…", "99887766…"), device and server dropped. */
export function statusSenderUser(jid: string | null | undefined): string {
	const raw = String(jid || '').trim().toLowerCase();
	if (!raw) return '';
	return raw.split('@')[0].split(':')[0].replace(/^\+/, '');
}

/** Our own user parts: from our JIDs (phone, LID) and the account's phone number. */
export function ownStatusUsers(ownJids: Array<string | null | undefined>, accountPhone?: string | null): Set<string> {
	const users = new Set<string>();
	for (const jid of ownJids || []) {
		const user = statusSenderUser(jid);
		if (user) users.add(user);
	}
	const digits = String(accountPhone || '').replace(/\D/g, '');
	if (digits.length >= 8) users.add(digits);
	return users;
}

export function isOwnStatusSender(senderWaId: string | null | undefined, own: Set<string>): boolean {
	const user = statusSenderUser(senderWaId);
	return Boolean(user) && own.has(user);
}

type DedupableStatus = {
	providerStatusId: string;
	isOwn?: boolean;
	mediaPath?: string | null;
	publishedAt?: Date | string | null;
};

/**
 * One row per story. The same story can be stored twice: under our LID with a `false_`
 * prefix (before the fix) and `true_` (after), or once under a contact's LID and once under
 * their phone JID. They share the bare message id, so keep one: ours first, then the one
 * whose media is on disk, then the first seen (lists come newest first).
 */
export function dedupeStatusRows<T extends DedupableStatus>(rows: T[]): { kept: T[]; dropped: T[] } {
	const best = new Map<string, T>();
	const order: string[] = [];
	const dropped: T[] = [];
	const score = (row: T) => (row.isOwn ? 2 : 0) + (String(row.mediaPath || '').trim() ? 1 : 0);
	for (const row of rows) {
		const key = statusMessageKey(row.providerStatusId) || String(row.providerStatusId || '');
		const current = best.get(key);
		if (!current) {
			best.set(key, row);
			order.push(key);
			continue;
		}
		if (score(row) > score(current)) {
			dropped.push(current);
			best.set(key, row);
		} else {
			dropped.push(row);
		}
	}
	return { kept: order.map(key => best.get(key)!), dropped };
}
