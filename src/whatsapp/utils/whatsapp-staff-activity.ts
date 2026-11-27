/** Audit action written while a staff member has WhatsApp open (throttled, see the gateway). */
export const STAFF_SESSION_ACTION = 'whatsapp.session.active';
/** At most one session mark per user and account in this window. */
export const STAFF_SESSION_MARK_MS = 5 * 60 * 1000;
/** A quiet gap longer than this starts a new session in the report. */
export const STAFF_SESSION_GAP_MS = 30 * 60 * 1000;

export type StaffActivityEvent = {
	at: Date | string;
	kind: 'present' | 'opened' | 'replied';
	conversationId?: string | null;
};

export type StaffSession = {
	startedAt: string;
	endedAt: string;
	durationSeconds: number;
	chatsOpened: number;
	messagesSent: number;
	chatsRepliedTo: number;
};

/**
 * Group activity into sessions: anything within STAFF_SESSION_GAP_MS of the previous event
 * belongs to the same sitting, which ends at its last event. Newest session first.
 */
export function buildStaffSessions(
	events: StaffActivityEvent[],
	gapMs = STAFF_SESSION_GAP_MS,
): StaffSession[] {
	const sorted = events
		.map(event => ({ ...event, time: new Date(event.at).getTime() }))
		.filter(event => Number.isFinite(event.time))
		.sort((a, b) => a.time - b.time);
	const sessions: StaffSession[] = [];
	let current: {
		start: number;
		end: number;
		opened: Set<string>;
		openedCount: number;
		sent: number;
		repliedTo: Set<string>;
	} | null = null;
	const close = () => {
		if (!current) return;
		sessions.push({
			startedAt: new Date(current.start).toISOString(),
			endedAt: new Date(current.end).toISOString(),
			durationSeconds: Math.max(0, Math.round((current.end - current.start) / 1000)),
			chatsOpened: current.opened.size,
			messagesSent: current.sent,
			chatsRepliedTo: current.repliedTo.size,
		});
	};
	for (const event of sorted) {
		if (!current || event.time - current.end > gapMs) {
			close();
			current = {
				start: event.time,
				end: event.time,
				opened: new Set(),
				openedCount: 0,
				sent: 0,
				repliedTo: new Set(),
			};
		}
		current.end = Math.max(current.end, event.time);
		const id = String(event.conversationId || '');
		if (event.kind === 'opened' && id) current.opened.add(id);
		if (event.kind === 'replied') {
			current.sent += 1;
			if (id) current.repliedTo.add(id);
		}
	}
	close();
	return sessions.reverse();
}

/* ───── WhatsApp open / closed log (the team presence history) ───── */

/** Written when a person's first WhatsApp tab connects (they "opened WhatsApp"). */
export const PRESENCE_ONLINE_ACTION = 'whatsapp.presence.online';
/** Written when their last WhatsApp tab disconnects (they "closed WhatsApp"). */
export const PRESENCE_OFFLINE_ACTION = 'whatsapp.presence.offline';
/** A reconnect within this window (network blip, page reload) continues the same sitting. */
export const PRESENCE_REJOIN_MS = 90 * 1000;

export type PresenceEvent = { at: Date | string; kind: 'online' | 'offline' | 'active' };

export type PresenceSession = {
	startedAt: string;
	/** null while they still have WhatsApp open */
	endedAt: string | null;
	durationSeconds: number;
	live: boolean;
	/** the close was not seen (server restart, crash): the end is their last known activity */
	endEstimated: boolean;
};

/**
 * Pair "opened" / "closed" events into sittings, newest first. A reconnect shortly after a
 * close continues the sitting; a sitting without a close ends at its last activity (or is
 * live when the person is online right now).
 */
export function buildPresenceSessions(
	events: PresenceEvent[],
	opts: { onlineNow?: boolean; now?: number; rejoinMs?: number } = {},
): PresenceSession[] {
	const now = opts.now ?? Date.now();
	const rejoin = opts.rejoinMs ?? PRESENCE_REJOIN_MS;
	const sorted = events
		.map(e => ({ kind: e.kind, time: new Date(e.at).getTime() }))
		.filter(e => Number.isFinite(e.time))
		.sort((a, b) => a.time - b.time);
	const out: PresenceSession[] = [];
	let open: { start: number; last: number } | null = null;
	let closed: { start: number; end: number } | null = null; // just closed: a quick rejoin reopens it
	const push = (start: number, end: number | null, estimated: boolean) =>
		out.push({
			startedAt: new Date(start).toISOString(),
			endedAt: end == null ? null : new Date(end).toISOString(),
			durationSeconds: Math.max(0, Math.round(((end ?? now) - start) / 1000)),
			live: end == null,
			endEstimated: estimated,
		});
	const flushClosed = () => {
		if (closed) push(closed.start, closed.end, false);
		closed = null;
	};
	for (const e of sorted) {
		if (e.kind === 'online') {
			if (open) {
				// a second "opened" without a close in between: the first one's end was not seen
				push(open.start, open.last, true);
				open = null;
			}
			if (closed && e.time - closed.end <= rejoin) {
				open = { start: closed.start, last: e.time };
				closed = null;
			} else {
				flushClosed();
				open = { start: e.time, last: e.time };
			}
		} else if (e.kind === 'offline') {
			if (!open) continue;
			closed = { start: open.start, end: Math.max(e.time, open.last) };
			open = null;
		} else if (open) {
			open.last = Math.max(open.last, e.time);
		} else if (!closed || e.time - closed.end > rejoin) {
			// activity with no "opened" before it (older data, or the open was missed)
			flushClosed();
			open = { start: e.time, last: e.time };
		}
	}
	flushClosed();
	if (open) {
		if (opts.onlineNow) push(open.start, null, false);
		else push(open.start, open.last, true);
	}
	return out.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
