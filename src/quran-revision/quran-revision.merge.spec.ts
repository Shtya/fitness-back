import { mergePagesRead } from './quran-revision.service';

describe('mergePagesRead', () => {
	it('keeps the newest change per day and page, drops junk', () => {
		const a = { '2026-11-25': { '160': 100, '161': 100 }, bad: { '1': 5 } };
		const b = { '2026-11-25': { '160': -200, '999': 5, '162': 'x' }, '2026-11-24': { '3': 50 } };
		expect(mergePagesRead(a, b)).toEqual({ '2026-11-24': { '3': 50 }, '2026-11-25': { '160': -200, '161': 100 } });
	});
	it('a later read wins over an older removal', () => {
		expect(mergePagesRead({ '2026-11-25': { '5': -100 } }, { '2026-11-25': { '5': 300 } })).toEqual({ '2026-11-25': { '5': 300 } });
	});
});
