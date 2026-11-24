import { CARDS_MAX, HABITS_MAX, cleanCard, cleanHabit, mergeById } from './habits.util';

describe('habits util', () => {
	it('cleans a habit and its log', () => {
		const h = cleanHabit({
			id: 'h_1',
			title: 'Quran',
			schedule: { type: 'weekdays', days: [1, 3, 9, 'x'] },
			log: { '2026-11-24': { s: 'done' }, '2026-11-23': { sub: ['a', 'bad id!'] }, nope: { s: 'done' }, '2026-11-22': { s: 'weird' } },
			subtasks: [{ id: 'a', text: 'Juz' }, { id: 'b', text: '  ' }],
			hacked: 1,
		})!;
		expect(h.schedule).toEqual({ type: 'weekdays', days: [1, 3], every: 2 });
		expect(h.log).toEqual({ '2026-11-24': { s: 'done' }, '2026-11-23': { sub: ['a'] } });
		expect(h.subtasks).toEqual([{ id: 'a', text: 'Juz' }]);
		expect(h.hacked).toBeUndefined();
		expect(cleanHabit({ id: 'bad id!' })).toBeNull();
	});

	it('merges by id, newest wins, keeps recent tombstones only', () => {
		const now = Date.UTC(2026, 10, 24);
		const merged = mergeById(
			[{ id: 'a', title: 'old', updatedAt: 1 }, { id: 'b', title: 'b', updatedAt: 1 }],
			[{ id: 'a', title: 'new', updatedAt: 2 }, { id: 'c', title: 'gone', updatedAt: 3, deletedAt: now - 90 * 86_400_000 }],
			cleanHabit,
			HABITS_MAX,
			now,
		);
		expect(merged.map(x => x.title)).toEqual(['new', 'b']);
		expect(mergeById([], [{ id: 'k', text: 'Keep going', tone: 'sun', updatedAt: 1 }], cleanCard, CARDS_MAX)[0].text).toBe('Keep going');
	});
});
