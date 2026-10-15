import { centsToDecimal, monthRange, nextBalanceCents, summarizeTracker, toCents, TrackerItem } from './wallet-tracker.rules';

const item = (kind: TrackerItem['kind'], amount: number, date: string): TrackerItem => ({
	id: `${kind}-${date}-${amount}`,
	kind,
	name: 'x',
	amount,
	date,
	notes: null,
});

describe('wallet tracker rules', () => {
	it('keeps decimal money exact', () => {
		expect(toCents('0.1') + toCents('0.2')).toBe(30);
		expect(centsToDecimal(toCents('1500.5') + toCents(99.99))).toBe('1600.49');
		expect(toCents('abc')).toBe(0);
	});

	it('computes month bounds including leap February', () => {
		expect(monthRange('2028-02-14')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
		expect(monthRange('2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
	});

	it('summarizes received this month and pending now / next month', () => {
		const summary = summarizeTracker(
			toCents(2500),
			[
				item('received', 1000, '2026-10-02'),
				item('received', 300, '2026-09-30'),
				item('pending', 400, '2026-10-20'),
				item('pending', 50, '2026-08-01'),
				item('pending', 700, '2026-11-15'),
				item('pending', 900, '2027-01-05'),
			],
			'2026-10-15',
		);
		expect(summary).toEqual({
			balance: 2500,
			receivedThisMonth: 1000,
			pendingThisMonth: 450,
			pendingNextMonth: 700,
			pendingTotal: 2050,
			month: '2026-10',
			nextMonth: '2026-11',
		});
	});

	it('rolls next month across the year end', () => {
		const summary = summarizeTracker(0, [item('pending', 10, '2027-01-31')], '2026-12-10');
		expect(summary.nextMonth).toBe('2027-01');
		expect(summary.pendingNextMonth).toBe(10);
	});

	it('applies manual balance edits', () => {
		expect(nextBalanceCents(1000, 'set', 250)).toBe(250);
		expect(nextBalanceCents(1000, 'add', 250)).toBe(1250);
		expect(nextBalanceCents(1000, 'subtract', 250)).toBe(750);
	});
});
