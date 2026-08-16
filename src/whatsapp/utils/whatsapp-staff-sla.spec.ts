import {
	OPEN_QUEUE_MAX_AGE_SECONDS,
	SLA_MEASURE_MAX_SECONDS,
	paceRank,
	staffPace,
} from './whatsapp-staff-sla';

describe('staffPace', () => {
	it('marks a piling inbox as backlog', () => {
		expect(
			staffPace({
				medianResponseSeconds: 40,
				waitingConversations: 4,
				oldestWaitSeconds: 120,
			}),
		).toBe('backlog');
	});

	it('marks a one-hour open wait as backlog', () => {
		expect(
			staffPace({
				medianResponseSeconds: 90,
				waitingConversations: 1,
				oldestWaitSeconds: 3600,
			}),
		).toBe('backlog');
	});

	it('classifies median reply time', () => {
		expect(staffPace({ medianResponseSeconds: 90, waitingConversations: 0 })).toBe('fast');
		expect(staffPace({ medianResponseSeconds: 10 * 60, waitingConversations: 0 })).toBe('ok');
		expect(staffPace({ medianResponseSeconds: 40 * 60, waitingConversations: 0 })).toBe('slow');
	});

	it('treats unanswered assigned chats as slow when there is no history', () => {
		expect(
			staffPace({
				medianResponseSeconds: null,
				assignedConversations: 2,
				waitingConversations: 1,
			}),
		).toBe('slow');
	});

	it('sorts riskier pace first', () => {
		expect(paceRank('backlog')).toBeLessThan(paceRank('fast'));
	});

	it('caps measured replies at one day so history sync cannot invent thousand-hour SLAs', () => {
		expect(SLA_MEASURE_MAX_SECONDS).toBe(24 * 60 * 60);
		expect(OPEN_QUEUE_MAX_AGE_SECONDS).toBe(14 * 24 * 60 * 60);
		expect(1_922 * 3600).toBeGreaterThan(SLA_MEASURE_MAX_SECONDS);
		expect(31_008 * 3600).toBeGreaterThan(OPEN_QUEUE_MAX_AGE_SECONDS);
	});
});
