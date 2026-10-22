import {
	maskEmail,
	normalizeAutoLockMinutes,
	pageLockActiveUntil,
	pageLockLockoutMinutes,
	pageLockPasscodeError,
	serializePageLock,
} from './whatsapp-page-lock';

describe('whatsapp page lock helpers', () => {
	it('validates the password length', () => {
		expect(pageLockPasscodeError('123')).toMatch(/at least/);
		expect(pageLockPasscodeError('    ')).toMatch(/spaces/);
		expect(pageLockPasscodeError('1234')).toBeNull();
		expect(pageLockPasscodeError(undefined)).toMatch(/required/);
	});

	it('only accepts the listed auto-lock minutes', () => {
		expect(normalizeAutoLockMinutes(15)).toBe(15);
		expect(normalizeAutoLockMinutes('0')).toBe(0);
		expect(normalizeAutoLockMinutes(7)).toBe(5);
		expect(normalizeAutoLockMinutes(7, 30)).toBe(30);
	});

	it('locks out after every 5 wrong tries, doubling up to an hour', () => {
		expect(pageLockLockoutMinutes(4)).toBe(0);
		expect(pageLockLockoutMinutes(5)).toBe(5);
		expect(pageLockLockoutMinutes(6)).toBe(0);
		expect(pageLockLockoutMinutes(10)).toBe(10);
		expect(pageLockLockoutMinutes(15)).toBe(20);
		expect(pageLockLockoutMinutes(50)).toBe(60);
	});

	it('masks the email for display', () => {
		expect(maskEmail('ahmed@example.com')).toBe('ah•••@example.com');
		expect(maskEmail('a@x.io')).toBe('a•@x.io');
		expect(maskEmail('')).toBe('');
	});

	it('serializes without leaking hashes and reports an active lockout', () => {
		const now = new Date('2026-10-22T10:00:00Z');
		const row: any = {
			passcode_hash: 'hash',
			enabled: true,
			auto_lock_minutes: 15,
			lock_on_hide: true,
			lock_on_open: false,
			failed_attempts: 7,
			locked_until: new Date('2026-10-22T10:05:00Z'),
			reset_code_hash: 'code',
		};
		const out = serializePageLock(row, 'ahmed@example.com', now);
		expect(out).toMatchObject({ configured: true, enabled: true, autoLockMinutes: 15, lockOnHide: true, attemptsLeft: 3 });
		expect(out.lockedUntil).toBe('2026-10-22T10:05:00.000Z');
		expect(JSON.stringify(out)).not.toContain('hash');
		expect(pageLockActiveUntil(row, new Date('2026-10-22T10:06:00Z'))).toBeNull();
		expect(serializePageLock({ ...row, passcode_hash: null }, null, now).enabled).toBe(false);
	});
});
