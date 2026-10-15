import { addDays, addMonths } from '../billing/billing-rules';

export type TrackerItemKind = 'pending' | 'received';

export type TrackerCurrency = 'EGP' | 'USD';

export type TrackerItem = {
	id: string;
	kind: TrackerItemKind;
	name: string;
	/** Nominal amount in `currency` (USD stays USD until received). */
	amount: number;
	/** EGP value used for totals: live rate for pending USD, locked EGP for received. */
	egpAmount: number;
	currency: TrackerCurrency;
	fxRate: number | null;
	date: string;
	notes: string | null;
};

export type TrackerSummary = {
	balance: number;
	receivedThisMonth: number;
	pendingThisMonth: number;
	pendingNextMonth: number;
	pendingTotal: number;
	month: string;
	nextMonth: string;
};

/** Money is summed in integer piasters so 0.1 + 0.2 never leaks into a balance. */
export function toCents(value: unknown): number {
	const n = Number(value);
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function fromCents(cents: number): number {
	return Math.round(cents) / 100;
}

export function centsToDecimal(cents: number): string {
	return (Math.round(cents) / 100).toFixed(2);
}

export function monthRange(ymd: string): { start: string; end: string } {
	const start = `${ymd.slice(0, 7)}-01`;
	return { start, end: addDays(addMonths(start, 1), -1) };
}

/**
 * Pending money due this month includes anything overdue: it has not arrived yet,
 * so it still belongs to "what I am waiting for now", not to a past month.
 */
export function summarizeTracker(balanceCents: number, items: TrackerItem[], today: string): TrackerSummary {
	const thisMonth = monthRange(today);
	const nextMonth = monthRange(addMonths(thisMonth.start, 1));
	let received = 0;
	let pendingNow = 0;
	let pendingNext = 0;
	let pendingAll = 0;
	for (const item of items) {
		const cents = toCents(item.egpAmount ?? item.amount);
		if (item.kind === 'received') {
			if (item.date >= thisMonth.start && item.date <= thisMonth.end) received += cents;
			continue;
		}
		pendingAll += cents;
		if (item.date <= thisMonth.end) pendingNow += cents;
		else if (item.date <= nextMonth.end) pendingNext += cents;
	}
	return {
		balance: fromCents(balanceCents),
		receivedThisMonth: fromCents(received),
		pendingThisMonth: fromCents(pendingNow),
		pendingNextMonth: fromCents(pendingNext),
		pendingTotal: fromCents(pendingAll),
		month: thisMonth.start.slice(0, 7),
		nextMonth: nextMonth.start.slice(0, 7),
	};
}

/** New balance after a manual edit; "set" replaces it, "add"/"subtract" move it. */
export function nextBalanceCents(currentCents: number, mode: 'set' | 'add' | 'subtract', amountCents: number): number {
	if (mode === 'set') return amountCents;
	return mode === 'add' ? currentCents + amountCents : currentCents - amountCents;
}

export function usdToEgpCents(usdAmount: number, rate: number): number {
	return toCents(fromCents(toCents(usdAmount)) * rate);
}

export function normalizeTrackerCurrency(value?: string | null): TrackerCurrency {
	return String(value || '').toUpperCase() === 'USD' ? 'USD' : 'EGP';
}
