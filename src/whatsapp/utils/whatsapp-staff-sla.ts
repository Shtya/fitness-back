export const SLA_FAST_SECONDS = 5 * 60;
export const SLA_OK_SECONDS = 15 * 60;
export const SLA_SLOW_SECONDS = 60 * 60;
/** Ignore WhatsApp-history catch-up where a "reply" is days or years later. */
export const SLA_MEASURE_MAX_SECONDS = 24 * 60 * 60;
/** Open queue: unanswered assigned chats whose last customer message is still recent. */
export const OPEN_QUEUE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export type StaffPace = 'fast' | 'ok' | 'slow' | 'backlog' | 'idle';

export type StaffSlaInput = {
	medianResponseSeconds?: number | null;
	assignedConversations?: number;
	waitingConversations?: number;
	oldestWaitSeconds?: number | null;
};

export function staffPace(row: StaffSlaInput): StaffPace {
	const waiting = Number(row.waitingConversations || 0);
	const oldest = row.oldestWaitSeconds == null ? null : Number(row.oldestWaitSeconds);
	if (waiting >= 3 || (oldest != null && oldest >= SLA_SLOW_SECONDS && waiting > 0)) {
		return 'backlog';
	}
	if (row.medianResponseSeconds == null) {
		if (waiting > 0) return 'slow';
		return Number(row.assignedConversations || 0) > 0 ? 'ok' : 'idle';
	}
	const median = Number(row.medianResponseSeconds);
	if (median <= SLA_FAST_SECONDS) return 'fast';
	if (median <= SLA_OK_SECONDS) return 'ok';
	return 'slow';
}

export function paceRank(pace: StaffPace) {
	if (pace === 'backlog') return 0;
	if (pace === 'slow') return 1;
	if (pace === 'ok') return 2;
	if (pace === 'fast') return 3;
	return 4;
}
