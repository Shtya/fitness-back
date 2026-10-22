/**
 * Mirrors migrations/20261022_whatsapp_page_lock.sql. Applied idempotently at boot
 * because production runs with TypeORM synchronize off.
 */
export const PAGE_LOCK_SCHEMA_STATEMENTS = [
	`CREATE TABLE IF NOT EXISTS whatsapp_page_locks (
		user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now(),
		updated_at timestamptz NOT NULL DEFAULT now(),
		passcode_hash text,
		enabled boolean NOT NULL DEFAULT false,
		auto_lock_minutes smallint NOT NULL DEFAULT 5,
		lock_on_hide boolean NOT NULL DEFAULT false,
		lock_on_open boolean NOT NULL DEFAULT false,
		failed_attempts smallint NOT NULL DEFAULT 0,
		locked_until timestamptz,
		reset_code_hash text,
		reset_code_expires timestamptz,
		reset_code_sent_at timestamptz,
		reset_code_attempts smallint NOT NULL DEFAULT 0
	)`,
];

export const PAGE_LOCK_MIN_LENGTH = 4;
export const PAGE_LOCK_MAX_LENGTH = 64;
/** 0 = no idle timer; the page still locks on open / tab switch when those options are on. */
export const PAGE_LOCK_AUTO_MINUTES = [0, 1, 5, 15, 30, 60, 240] as const;
export const PAGE_LOCK_MAX_ATTEMPTS = 5;
export const PAGE_LOCK_RESET_CODE_TTL_MS = 5 * 60 * 1000;
export const PAGE_LOCK_RESET_RESEND_MS = 60 * 1000;
export const PAGE_LOCK_RESET_MAX_ATTEMPTS = 5;

export type PageLockRow = {
	user_id: string;
	passcode_hash: string | null;
	enabled: boolean;
	auto_lock_minutes: number;
	lock_on_hide: boolean;
	lock_on_open: boolean;
	failed_attempts: number;
	locked_until: Date | string | null;
	reset_code_hash: string | null;
	reset_code_expires: Date | string | null;
	reset_code_sent_at: Date | string | null;
	reset_code_attempts: number;
};

export function pageLockPasscodeError(value: unknown): string | null {
	if (typeof value !== 'string') return 'Password is required';
	if (value.length < PAGE_LOCK_MIN_LENGTH) return `Password must be at least ${PAGE_LOCK_MIN_LENGTH} characters`;
	if (value.length > PAGE_LOCK_MAX_LENGTH) return `Password must be at most ${PAGE_LOCK_MAX_LENGTH} characters`;
	if (!value.trim()) return 'Password cannot be only spaces';
	return null;
}

export function normalizeAutoLockMinutes(value: unknown, fallback = 5): number {
	const n = Number(value);
	return (PAGE_LOCK_AUTO_MINUTES as readonly number[]).includes(n) ? n : fallback;
}

/** Lockout after every PAGE_LOCK_MAX_ATTEMPTS wrong tries: 5, 10, 20, 40, then 60 minutes. */
export function pageLockLockoutMinutes(failedAttempts: number): number {
	if (failedAttempts < PAGE_LOCK_MAX_ATTEMPTS || failedAttempts % PAGE_LOCK_MAX_ATTEMPTS !== 0) return 0;
	const round = failedAttempts / PAGE_LOCK_MAX_ATTEMPTS;
	return Math.min(60, 5 * 2 ** (round - 1));
}

export function maskEmail(email: string | null | undefined): string {
	const value = String(email || '').trim();
	const at = value.indexOf('@');
	if (at < 1) return '';
	const name = value.slice(0, at);
	const shown = name.length <= 2 ? name[0] : `${name[0]}${name[1]}`;
	return `${shown}${'•'.repeat(Math.max(1, Math.min(6, name.length - shown.length)))}${value.slice(at)}`;
}

function toDate(value: Date | string | null | undefined): Date | null {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

export function pageLockActiveUntil(row: Pick<PageLockRow, 'locked_until'> | null, now = new Date()): Date | null {
	const until = toDate(row?.locked_until);
	return until && until.getTime() > now.getTime() ? until : null;
}

export function serializePageLock(row: PageLockRow | null, email: string | null, now = new Date()) {
	const until = pageLockActiveUntil(row, now);
	const failed = Number(row?.failed_attempts || 0);
	return {
		configured: Boolean(row?.passcode_hash),
		enabled: Boolean(row?.passcode_hash && row?.enabled),
		autoLockMinutes: normalizeAutoLockMinutes(row?.auto_lock_minutes),
		lockOnHide: Boolean(row?.lock_on_hide),
		lockOnOpen: Boolean(row?.lock_on_open),
		lockedUntil: until ? until.toISOString() : null,
		attemptsLeft: PAGE_LOCK_MAX_ATTEMPTS - (failed % PAGE_LOCK_MAX_ATTEMPTS),
		maxAttempts: PAGE_LOCK_MAX_ATTEMPTS,
		email: maskEmail(email),
	};
}

export { toDate as pageLockDate };
