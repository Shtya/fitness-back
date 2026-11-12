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
