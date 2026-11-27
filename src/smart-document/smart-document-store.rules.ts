/**
 * Pure rules for the Documents editor's server copy: clean what the client sends, and decide
 * which copy wins when the browser and the database disagree.
 */

export const MAX_DOCS_PER_USER = 300;
export const MAX_CONTENT_CHARS = 2_000_000;
const CLIENT_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FUTURE_SLACK_MS = 5 * 60_000;

export type IncomingDoc = {
	clientId: string;
	title: string;
	titleLocked: boolean;
	content: string;
	updatedAt: Date;
};

/** A doc from the editor, or null when it cannot be stored (bad id, not an object). */
export function normalizeIncomingDoc(raw: unknown, now = new Date()): IncomingDoc | null {
	if (!raw || typeof raw !== 'object') return null;
	const doc = raw as Record<string, unknown>;
	const clientId = String(doc.id ?? doc.clientId ?? '').trim();
	if (!CLIENT_ID.test(clientId)) return null;
	const title = String(doc.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
	const content = String(doc.content ?? '').slice(0, MAX_CONTENT_CHARS);
	const stamp = new Date(typeof doc.updatedAt === 'number' ? doc.updatedAt : String(doc.updatedAt ?? ''));
	// A client clock far in the future would make that copy win forever: cap it at "now".
	const updatedAt =
		Number.isNaN(stamp.getTime()) || stamp.getTime() > now.getTime() + FUTURE_SLACK_MS ? now : stamp;
	return { clientId, title, titleLocked: doc.titleLocked === true, content, updatedAt };
}

export type StoredState = { clientUpdatedAt: Date; deletedAt: Date | null } | null;

/**
 * What to do with an incoming copy given the stored one:
 * - 'insert' nothing stored yet;
 * - 'update' the incoming copy is as new or newer;
 * - 'restore' it was deleted, but edited after the delete (the edit wins);
 * - 'keep' the stored copy is newer, or the delete is newer than this edit.
 */
export function decideUpsert(stored: StoredState, incoming: { updatedAt: Date }): 'insert' | 'update' | 'restore' | 'keep' {
	if (!stored) return 'insert';
	const at = incoming.updatedAt.getTime();
	if (stored.deletedAt) return at > stored.deletedAt.getTime() ? 'restore' : 'keep';
	return at >= stored.clientUpdatedAt.getTime() ? 'update' : 'keep';
}

/** Latest shared copy per editor id (shares are re-published, so one id can have several rows). */
export function latestSharePerDoc<T extends { localDocId: string | null; updated_at: Date }>(rows: T[]): T[] {
	const best = new Map<string, T>();
	for (const row of rows) {
		const id = String(row.localDocId || '').trim();
		if (!CLIENT_ID.test(id)) continue;
		const current = best.get(id);
		if (!current || new Date(row.updated_at).getTime() > new Date(current.updated_at).getTime()) best.set(id, row);
	}
	return [...best.values()];
}
