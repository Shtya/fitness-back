import { UserRole } from '../../entities/global.entity';
import {
	addMonths,
	canManageClient,
	clientScopeSql,
	defaultPeriodStart,
	planEndDate,
	planOwnerFor,
	resolvePeriod,
} from './billing-rules';

describe('billing rules', () => {
	describe('planEndDate', () => {
		it('covers whole calendar months, inclusive', () => {
			expect(planEndDate('2026-10-15', { interval: 'monthly', intervalCount: 1 })).toBe('2026-11-14');
			expect(planEndDate('2026-10-01', { interval: 'monthly', intervalCount: 3 })).toBe('2026-12-31');
			expect(planEndDate('2026-10-01', { interval: 'quarterly', intervalCount: 1 })).toBe('2026-12-31');
			expect(planEndDate('2026-01-01', { interval: 'yearly', intervalCount: 1 })).toBe('2026-12-31');
		});

		it('clamps month ends instead of spilling into the next month', () => {
			expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
			expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
			expect(planEndDate('2026-01-31', { interval: 'monthly', intervalCount: 1 })).toBe('2026-02-27');
		});

		it('uses day-based length when set', () => {
			expect(planEndDate('2026-10-15', { interval: 'one_time', durationDays: 30 })).toBe('2026-11-13');
			expect(planEndDate('2026-10-15', { interval: 'one_time', durationDays: 1 })).toBe('2026-10-15');
		});

		it('returns null for a package without a length', () => {
			expect(planEndDate('2026-10-15', { interval: 'one_time' })).toBeNull();
		});
	});

	describe('defaultPeriodStart', () => {
		it('continues the day after a running subscription', () => {
			expect(defaultPeriodStart('2026-10-20', '2026-10-15')).toBe('2026-10-21');
			expect(defaultPeriodStart('2026-10-15', '2026-10-15')).toBe('2026-10-16');
		});

		it('starts today when there is no subscription or it already ended', () => {
			expect(defaultPeriodStart(null, '2026-10-15')).toBe('2026-10-15');
			expect(defaultPeriodStart('2026-09-01', '2026-10-15')).toBe('2026-10-15');
		});
	});

	describe('resolvePeriod', () => {
		const today = '2026-10-15';
		const monthly = { interval: 'monthly', intervalCount: 1 };

		it('extends from the current end date when a package is chosen', () => {
			expect(resolvePeriod({ plan: monthly, currentEnd: '2026-10-31', today })).toEqual({ start: '2026-11-01', end: '2026-11-30' });
		});

		it('honours explicit dates over the package length', () => {
			expect(resolvePeriod({ periodFrom: '2026-10-01', periodTo: '2026-10-10', plan: monthly, today })).toEqual({ start: '2026-10-01', end: '2026-10-10' });
		});

		it('does not touch the subscription for a plain payment', () => {
			expect(resolvePeriod({ today })).toBeNull();
		});

		it('rejects a start without an end and reversed ranges', () => {
			expect(() => resolvePeriod({ periodFrom: '2026-10-01', today })).toThrow(/end date is required/);
			expect(() => resolvePeriod({ periodFrom: '2026-10-10', periodTo: '2026-10-01', today })).toThrow(/on or after/);
			expect(() => resolvePeriod({ periodFrom: '2026-02-30', periodTo: '2026-03-01', today })).toThrow(/Invalid/);
		});
	});

	describe('scope', () => {
		const admin = { id: 'admin-1', role: UserRole.ADMIN };
		const coach = { id: 'coach-1', role: UserRole.COACH, adminId: 'admin-1' };
		const superAdmin = { id: 'sa', role: UserRole.SUPER_ADMIN };
		const client = { id: 'c', role: UserRole.CLIENT, adminId: 'admin-1' };

		it('limits admins to their gym and coaches to their own clients', () => {
			expect(canManageClient(admin, { adminId: 'admin-1' })).toBe(true);
			expect(canManageClient(admin, { adminId: 'admin-2' })).toBe(false);
			expect(canManageClient(coach, { adminId: 'admin-1', coachId: 'coach-1' })).toBe(true);
			expect(canManageClient(coach, { adminId: 'admin-1', coachId: 'coach-2' })).toBe(false);
			expect(canManageClient(superAdmin, { adminId: 'anything' })).toBe(true);
			expect(canManageClient(client, { adminId: 'admin-1' })).toBe(false);
		});

		it('builds matching SQL predicates', () => {
			expect(clientScopeSql(superAdmin, 'u')).toBeNull();
			expect(clientScopeSql(admin, 'u')).toEqual({ sql: 'u.adminId = :scopeAdminId', params: { scopeAdminId: 'admin-1' } });
			expect(clientScopeSql(coach, 'u')).toEqual({ sql: 'u.coachId = :scopeCoachId', params: { scopeCoachId: 'coach-1' } });
			expect(clientScopeSql(client, 'u')?.sql).toBe('1 = 0');
		});

		it('resolves package ownership to the gym', () => {
			expect(planOwnerFor(superAdmin)).toBeUndefined();
			expect(planOwnerFor(admin)).toBe('admin-1');
			expect(planOwnerFor(coach)).toBe('admin-1');
		});
	});
});
