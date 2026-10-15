import {
	centsToDecimal,
	monthRange,
	nextBalanceCents,
	normalizeTrackerCurrency,
	summarizeTracker,
	toCents,
	TrackerItem,
	usdToEgpCents,
} from './wallet-tracker.rules';

const item = (kind: TrackerItem['kind'], amount: number, date: string, egpAmount = amount): TrackerItem => ({
	id: `${kind}-${date}-${amount}`,
	kind,
	name: 'x',
	amount,
	egpAmount,
	currency: amount === egpAmount ? 'EGP' : 'USD',
	fxRate: amount === egpAmount ? null : egpAmount / amount,
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

	it('summarizes using egpAmount so USD pending converts for totals', () => {
		const summary = summarizeTracker(
			toCents(2500),
			[
				item('received', 1000, '2026-10-02'),
				item('received', 300, '2026-09-30'),
				item('pending', 400, '2026-10-20'),
				item('pending', 50, '2026-08-01'),
				item('pending', 700, '2026-11-15'),
				item('pending', 900, '2027-01-05'),
				item('pending', 10, '2026-10-18', 530), // $10 → 530 EGP live
			],
			'2026-10-15',
		);
		expect(summary).toEqual({
			balance: 2500,
			receivedThisMonth: 1000,
			pendingThisMonth: 980,
			pendingNextMonth: 700,
			pendingTotal: 2580,
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

	it('converts USD to EGP cents at the given rate', () => {
		expect(usdToEgpCents(400, 50)).toBe(20_000_00);
		expect(centsToDecimal(usdToEgpCents(10.5, 53.1))).toBe('557.55');
		expect(normalizeTrackerCurrency('usd')).toBe('USD');
		expect(normalizeTrackerCurrency('EGP')).toBe('EGP');
	});
});
