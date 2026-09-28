import { parsePagination } from './pagination';

describe('parsePagination (audit B4)', () => {
	it('parses numeric query strings', () => {
		expect(parsePagination('3', '25')).toEqual({ page: 3, limit: 25, take: 25, skip: 50 });
	});

	it('never yields NaN or a negative offset for bad input', () => {
		for (const bad of ['abc', '', '0', '-2', 'NaN', undefined, null, {}]) {
			const result = parsePagination(bad, bad);
			expect(result.page).toBe(1);
			expect(result.skip).toBe(0);
			expect(result.take).toBe(20);
		}
	});

	it('caps the limit and honours per-endpoint defaults', () => {
		expect(parsePagination(1, '5000').take).toBe(100);
		expect(parsePagination(2, undefined, { defaultLimit: 12 }).skip).toBe(12);
		expect(parsePagination(1, '80', { maxLimit: 50 }).take).toBe(50);
		expect(parsePagination('2.9', '10.7')).toMatchObject({ page: 2, take: 10, skip: 10 });
	});
});
