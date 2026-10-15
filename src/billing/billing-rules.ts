import { BadRequestException } from '@nestjs/common';

import { UserRole } from '../../entities/global.entity';

export type BillingActor = { id: string; role: UserRole | string; adminId?: string | null };

export type PlanDuration = {
	interval?: string | null;
	intervalCount?: number | null;
	durationDays?: number | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const INTERVAL_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Gym-local calendar day; billing dates are plain dates, not instants. */
export function todayYmd(now = new Date()): string {
	return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export function isYmd(value: unknown): value is string {
	if (typeof value !== 'string' || !YMD.test(value)) return false;
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(ymd: string, days: number): string {
	const d = new Date(`${ymd}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Calendar months, clamped to the target month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonths(ymd: string, months: number): string {
	const [y, m, day] = ymd.split('-').map(Number);
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return target.toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
	return Math.round((Date.parse(`${toYmd}T00:00:00Z`) - Date.parse(`${fromYmd}T00:00:00Z`)) / 86_400_000);
}

/** Last covered day for a plan starting on `start` (inclusive), or null when the plan has no length. */
export function planEndDate(start: string, plan: PlanDuration): string | null {
	const days = Number(plan.durationDays || 0);
	if (days > 0) return addDays(start, days - 1);
	const months = INTERVAL_MONTHS[String(plan.interval || '')];
	if (!months) return null;
	return addDays(addMonths(start, months * Math.max(1, Number(plan.intervalCount || 1))), -1);
}

/** A renewal continues the day after a still-running subscription; otherwise it starts today. */
export function defaultPeriodStart(currentEnd: string | null | undefined, today: string): string {
	return currentEnd && isYmd(currentEnd) && currentEnd >= today ? addDays(currentEnd, 1) : today;
}

/**
 * Subscription period a payment pays for. Returns null when the payment does not
 * extend the subscription (no dates and no plan length).
 */
export function resolvePeriod(input: {
	periodFrom?: string | null;
	periodTo?: string | null;
	plan?: PlanDuration | null;
	currentEnd?: string | null;
	today: string;
}): { start: string; end: string } | null {
	const { periodFrom, periodTo, plan, currentEnd, today } = input;
	if (periodFrom && !isYmd(periodFrom)) throw new BadRequestException('Invalid period start date');
	if (periodTo && !isYmd(periodTo)) throw new BadRequestException('Invalid period end date');

	const start = periodFrom || defaultPeriodStart(currentEnd, today);
	const end = periodTo || (plan ? planEndDate(start, plan) : null);
	if (!end) {
		if (periodFrom) throw new BadRequestException('Subscription end date is required');
		return null;
	}
	if (end < start) throw new BadRequestException('Subscription end date must be on or after the start date');
	return { start, end };
}

/** Plan ownership: super admin manages global plans; everyone else works inside their gym. */
export function planOwnerFor(actor: BillingActor): string | null | undefined {
	if (actor?.role === UserRole.SUPER_ADMIN) return undefined;
	if (actor?.role === UserRole.ADMIN) return actor.id;
	return actor?.adminId ?? null;
}

/** SQL predicate limiting a users alias to the clients this actor manages. */
export function clientScopeSql(actor: BillingActor, alias: string): { sql: string; params: Record<string, unknown> } | null {
	if (actor?.role === UserRole.SUPER_ADMIN) return null;
	if (actor?.role === UserRole.ADMIN) return { sql: `${alias}.adminId = :scopeAdminId`, params: { scopeAdminId: actor.id } };
	if (actor?.role === UserRole.COACH) return { sql: `${alias}.coachId = :scopeCoachId`, params: { scopeCoachId: actor.id } };
	return { sql: '1 = 0', params: {} };
}

export function canManageClient(actor: BillingActor, client: { adminId?: string | null; coachId?: string | null }): boolean {
	if (actor?.role === UserRole.SUPER_ADMIN) return true;
	if (actor?.role === UserRole.ADMIN) return client.adminId === actor.id;
	if (actor?.role === UserRole.COACH) return client.coachId === actor.id;
	return false;
}

export function money(value: unknown): number {
	return Math.round(Number(value || 0) * 100) / 100;
}
