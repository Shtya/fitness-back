import { computeNextRecurringRunAt, validTimeZone } from './whatsapp-schedule-time';

const SUN_TO_THU = [0, 1, 2, 3, 4];

describe('recurring schedule time zones', () => {
	// Wed 18 Nov 2026, 08:00 UTC. Egypt is on winter time (UTC+2), Qatar is UTC+3 all year.
	const after = new Date('2026-11-18T08:00:00.000Z');

	it('5:10 PM in Cairo in winter is 15:10 UTC', () => {
		const next = computeNextRecurringRunAt({ after, timeOfDay: '17:10', daysOfWeek: SUN_TO_THU, timezone: 'Africa/Cairo' });
		expect(next?.toISOString()).toBe('2026-11-18T15:10:00.000Z');
	});

	it('the old fixed Qatar zone sends the same 5:10 PM an hour earlier for Egypt (the bug)', () => {
		const next = computeNextRecurringRunAt({ after, timeOfDay: '17:10', daysOfWeek: SUN_TO_THU, timezone: 'Asia/Qatar' });
		expect(next?.toISOString()).toBe('2026-11-18T14:10:00.000Z'); // = 4:10 PM in Cairo
	});

	it('follows Egypt summer time (UTC+3) in July', () => {
		const summer = new Date('2026-07-15T08:00:00.000Z');
		const next = computeNextRecurringRunAt({ after: summer, timeOfDay: '17:10', daysOfWeek: [3], timezone: 'Africa/Cairo' });
		expect(next?.toISOString()).toBe('2026-07-15T14:10:00.000Z');
	});

	it('accepts real IANA zones only', () => {
		expect(validTimeZone('Africa/Cairo')).toBe('Africa/Cairo');
		expect(validTimeZone('Not/AZone')).toBeNull();
		expect(validTimeZone('')).toBeNull();
	});
});
