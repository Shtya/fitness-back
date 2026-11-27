import { buildPresenceSessions } from './whatsapp-staff-activity';

const t = (hm: string) => `2026-11-27T${hm}:00.000Z`;
const ms = (hm: string) => Date.parse(t(hm));

describe('team presence history (opened / closed WhatsApp)', () => {
	it('pairs opened and closed into sittings, newest first', () => {
		const sessions = buildPresenceSessions(
			[
				{ at: t('09:00'), kind: 'online' },
				{ at: t('09:40'), kind: 'offline' },
				{ at: t('13:10'), kind: 'online' },
				{ at: t('14:00'), kind: 'offline' },
			],
			{ now: ms('18:00') },
		);
		expect(sessions.map(s => [s.startedAt, s.endedAt, s.durationSeconds, s.live])).toEqual([
			[t('13:10'), t('14:00'), 50 * 60, false],
			[t('09:00'), t('09:40'), 40 * 60, false],
		]);
	});

	it('a quick reconnect (page reload, network blip) stays one sitting', () => {
		const sessions = buildPresenceSessions(
			[
				{ at: t('09:00'), kind: 'online' },
				{ at: t('09:20'), kind: 'offline' },
				{ at: '2026-11-27T09:20:40.000Z', kind: 'online' },
				{ at: t('10:00'), kind: 'offline' },
			],
			{ now: ms('18:00') },
		);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ startedAt: t('09:00'), endedAt: t('10:00'), durationSeconds: 3600 });
	});

	it('still open right now: live, counted up to now', () => {
		const [s] = buildPresenceSessions([{ at: t('17:00'), kind: 'online' }], { onlineNow: true, now: ms('17:30') });
		expect(s).toMatchObject({ startedAt: t('17:00'), endedAt: null, live: true, durationSeconds: 1800 });
	});

	it('a close that was never seen ends at the last activity, marked as estimated', () => {
		const sessions = buildPresenceSessions(
			[
				{ at: t('08:00'), kind: 'online' },
				{ at: t('08:05'), kind: 'active' },
				{ at: t('08:25'), kind: 'active' },
				{ at: t('11:00'), kind: 'online' },
				{ at: t('11:30'), kind: 'offline' },
			],
			{ now: ms('18:00') },
		);
		expect(sessions.map(s => [s.startedAt, s.endedAt, s.endEstimated])).toEqual([
			[t('11:00'), t('11:30'), false],
			[t('08:00'), t('08:25'), true],
		]);
	});

	it('older data with only activity marks still shows when they were there', () => {
		const sessions = buildPresenceSessions(
			[
				{ at: t('10:00'), kind: 'active' },
				{ at: t('10:05'), kind: 'active' },
			],
			{ now: ms('18:00') },
		);
		expect(sessions).toEqual([{ startedAt: t('10:00'), endedAt: t('10:05'), durationSeconds: 300, live: false, endEstimated: true }]);
	});

	it('a close with nothing open is ignored', () => {
		expect(buildPresenceSessions([{ at: t('10:00'), kind: 'offline' }], { now: ms('18:00') })).toEqual([]);
	});
});
