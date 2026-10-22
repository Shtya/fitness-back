import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { DataSource } from 'typeorm';
import { MailService } from 'common/nodemailer';
import {
	ChangePageLockDto,
	RemovePageLockDto,
	ResetPageLockWithAccountPasswordDto,
	ResetPageLockWithCodeDto,
	SetupPageLockDto,
	UpdatePageLockSettingsDto,
} from '../dto/whatsapp-page-lock.dto';
import {
	PAGE_LOCK_RESET_CODE_TTL_MS,
	PAGE_LOCK_RESET_MAX_ATTEMPTS,
	PAGE_LOCK_RESET_RESEND_MS,
	PAGE_LOCK_SCHEMA_STATEMENTS,
	PageLockRow,
	normalizeAutoLockMinutes,
	pageLockActiveUntil,
	pageLockDate,
	pageLockLockoutMinutes,
	pageLockPasscodeError,
	serializePageLock,
} from '../utils/whatsapp-page-lock';

const HASH_ROUNDS = 10;

/** Per-user password that guards the WhatsApp workspace screen. The unlock itself lives in the browser tab. */
@Injectable()
export class WhatsAppPageLockService implements OnModuleInit {
	private readonly logger = new Logger(WhatsAppPageLockService.name);
	private ready: Promise<void> | null = null;

	constructor(
		@InjectDataSource() private readonly dataSource: DataSource,
		private readonly mail: MailService,
	) {}

	onModuleInit() {
		return this.ensureSchema();
	}

	private ensureSchema() {
		if (!this.ready) {
			this.ready = (async () => {
				for (const statement of PAGE_LOCK_SCHEMA_STATEMENTS) {
					try {
						await this.dataSource.query(statement);
					} catch (error) {
						this.logger.error(`Could not ensure page lock table: ${error instanceof Error ? error.message : error}`);
					}
				}
			})();
		}
		return this.ready;
	}

	private async row(userId: string): Promise<PageLockRow | null> {
		await this.ensureSchema();
		const rows = await this.dataSource.query('SELECT * FROM whatsapp_page_locks WHERE user_id = $1', [userId]);
		return rows[0] || null;
	}

	private async user(userId: string): Promise<{ email: string; name: string; password: string } | null> {
		const rows = await this.dataSource.query('SELECT email, name, password FROM users WHERE id = $1', [userId]);
		return rows[0] || null;
	}

	private async save(userId: string, patch: Record<string, unknown>) {
		const keys = Object.keys(patch);
		const cols = ['user_id', ...keys];
		const values = [userId, ...keys.map(key => patch[key])];
		const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
		const updates = [...keys.map(key => `${key} = EXCLUDED.${key}`), 'updated_at = now()'].join(', ');
		await this.dataSource.query(
			`INSERT INTO whatsapp_page_locks (${cols.join(', ')}) VALUES (${placeholders})
			 ON CONFLICT (user_id) DO UPDATE SET ${updates}`,
			values,
		);
	}

	async status(userId: string) {
		const [row, user] = await Promise.all([this.row(userId), this.user(userId)]);
		return serializePageLock(row, user?.email ?? null);
	}

	async setup(userId: string, dto: SetupPageLockDto) {
		const row = await this.row(userId);
		if (row?.passcode_hash) throw new BadRequestException('A page lock password already exists. Change it instead.');
		this.assertPasscode(dto.passcode);
		await this.save(userId, {
			passcode_hash: await bcrypt.hash(dto.passcode, HASH_ROUNDS),
			enabled: true,
			auto_lock_minutes: normalizeAutoLockMinutes(dto.autoLockMinutes, normalizeAutoLockMinutes(row?.auto_lock_minutes)),
			failed_attempts: 0,
			locked_until: null,
			...this.clearedReset(),
		});
		return this.status(userId);
	}

	/** Checks the password and counts wrong tries; repeated failures lock the screen for a while. */
	async verify(userId: string, passcode: string) {
		const row = await this.requireConfigured(userId);
		await this.checkPasscode(userId, row, passcode);
		return { ok: true, ...(await this.status(userId)) };
	}

	async updateSettings(userId: string, dto: UpdatePageLockSettingsDto) {
		const row = await this.requireConfigured(userId);
		const patch: Record<string, unknown> = {};
		if (dto.enabled === false && row.enabled) {
			await this.checkPasscode(userId, row, dto.passcode ?? '');
			patch.enabled = false;
		} else if (dto.enabled === true) {
			patch.enabled = true;
		}
		if (dto.autoLockMinutes !== undefined) patch.auto_lock_minutes = normalizeAutoLockMinutes(dto.autoLockMinutes);
		if (dto.lockOnHide !== undefined) patch.lock_on_hide = Boolean(dto.lockOnHide);
		if (dto.lockOnOpen !== undefined) patch.lock_on_open = Boolean(dto.lockOnOpen);
		if (Object.keys(patch).length) await this.save(userId, patch);
		return this.status(userId);
	}

	async change(userId: string, dto: ChangePageLockDto) {
		const row = await this.requireConfigured(userId);
		await this.checkPasscode(userId, row, dto.currentPasscode);
		this.assertPasscode(dto.newPasscode);
		if (await bcrypt.compare(dto.newPasscode, row.passcode_hash as string)) {
			throw new BadRequestException('The new password must be different from the current one');
		}
		await this.save(userId, { passcode_hash: await bcrypt.hash(dto.newPasscode, HASH_ROUNDS), ...this.clearedReset() });
		return this.status(userId);
	}

	async remove(userId: string, dto: RemovePageLockDto) {
		const row = await this.requireConfigured(userId);
		await this.checkPasscode(userId, row, dto.passcode);
		await this.save(userId, {
			passcode_hash: null,
			enabled: false,
			failed_attempts: 0,
			locked_until: null,
			...this.clearedReset(),
		});
		return this.status(userId);
	}

	/** Emails a 6-digit code to the signed-in user's own address. */
	async sendResetCode(userId: string) {
		const row = await this.requireConfigured(userId);
		const user = await this.user(userId);
		if (!user?.email) throw new BadRequestException('Your account has no email address. Use your account password instead.');
		const sentAt = pageLockDate(row.reset_code_sent_at);
		const wait = sentAt ? PAGE_LOCK_RESET_RESEND_MS - (Date.now() - sentAt.getTime()) : 0;
		if (wait > 0) {
			throw new HttpException(
				{ message: `Please wait ${Math.ceil(wait / 1000)} seconds before asking for another code`, retryAfterSeconds: Math.ceil(wait / 1000) },
				HttpStatus.TOO_MANY_REQUESTS,
			);
		}
		const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
		await this.save(userId, {
			reset_code_hash: await bcrypt.hash(code, HASH_ROUNDS),
			reset_code_expires: new Date(Date.now() + PAGE_LOCK_RESET_CODE_TTL_MS),
			reset_code_sent_at: new Date(),
			reset_code_attempts: 0,
		});
		try {
			await this.mail.sendOTPEmail(user.email, code, 'reset your WhatsApp page lock password');
		} catch (error) {
			this.logger.error(`Page lock reset email failed: ${error instanceof Error ? error.message : error}`);
			await this.save(userId, this.clearedReset());
			throw new BadRequestException('Could not send the email. Use your account password instead.');
		}
		return { sent: true, email: (await this.status(userId)).email, expiresInSeconds: PAGE_LOCK_RESET_CODE_TTL_MS / 1000 };
	}

	async resetWithCode(userId: string, dto: ResetPageLockWithCodeDto) {
		const row = await this.requireConfigured(userId);
		const expires = pageLockDate(row.reset_code_expires);
		if (!row.reset_code_hash || !expires || expires.getTime() < Date.now()) {
			throw new BadRequestException('The code expired. Ask for a new one.');
		}
		if (Number(row.reset_code_attempts || 0) >= PAGE_LOCK_RESET_MAX_ATTEMPTS) {
			await this.save(userId, this.clearedReset());
			throw new BadRequestException('Too many wrong codes. Ask for a new one.');
		}
		if (!(await bcrypt.compare(String(dto.code || '').trim(), row.reset_code_hash))) {
			await this.save(userId, { reset_code_attempts: Number(row.reset_code_attempts || 0) + 1 });
			throw new BadRequestException('Wrong code');
		}
		return this.applyNewPasscode(userId, dto.newPasscode);
	}

	async resetWithAccountPassword(userId: string, dto: ResetPageLockWithAccountPasswordDto) {
		const row = await this.requireConfigured(userId);
		const user = await this.user(userId);
		const until = pageLockActiveUntil(row);
		if (until) this.throwLockedOut(until);
		if (!user?.password || !(await bcrypt.compare(dto.accountPassword || '', user.password))) {
			await this.recordFailure(userId, row);
			throw new BadRequestException('Wrong account password');
		}
		return this.applyNewPasscode(userId, dto.newPasscode);
	}

	private async applyNewPasscode(userId: string, passcode: string) {
		this.assertPasscode(passcode);
		await this.save(userId, {
			passcode_hash: await bcrypt.hash(passcode, HASH_ROUNDS),
			enabled: true,
			failed_attempts: 0,
			locked_until: null,
			...this.clearedReset(),
		});
		return { ok: true, ...(await this.status(userId)) };
	}

	private async requireConfigured(userId: string): Promise<PageLockRow> {
		const row = await this.row(userId);
		if (!row?.passcode_hash) throw new BadRequestException('Set a page lock password first');
		return row;
	}

	private assertPasscode(value: string) {
		const error = pageLockPasscodeError(value);
		if (error) throw new BadRequestException(error);
	}

	private async checkPasscode(userId: string, row: PageLockRow, passcode: string) {
		const until = pageLockActiveUntil(row);
		if (until) this.throwLockedOut(until);
		if (await bcrypt.compare(String(passcode || ''), row.passcode_hash as string)) {
			if (row.failed_attempts || row.locked_until) await this.save(userId, { failed_attempts: 0, locked_until: null });
			return;
		}
		const next = await this.recordFailure(userId, row);
		if (next.lockedUntil) this.throwLockedOut(next.lockedUntil);
		throw new HttpException(
			{ message: 'Wrong password', attemptsLeft: next.attemptsLeft },
			HttpStatus.BAD_REQUEST,
		);
	}

	private async recordFailure(userId: string, row: PageLockRow) {
		const failed = Number(row.failed_attempts || 0) + 1;
		const minutes = pageLockLockoutMinutes(failed);
		const lockedUntil = minutes ? new Date(Date.now() + minutes * 60_000) : null;
		await this.save(userId, { failed_attempts: failed, locked_until: lockedUntil });
		const status = serializePageLock({ ...row, failed_attempts: failed, locked_until: lockedUntil }, null);
		return { lockedUntil, attemptsLeft: status.attemptsLeft };
	}

	private throwLockedOut(until: Date): never {
		const seconds = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000));
		throw new HttpException(
			{ message: 'Too many wrong tries. Try again later.', lockedUntil: until.toISOString(), retryAfterSeconds: seconds },
			HttpStatus.TOO_MANY_REQUESTS,
		);
	}

	private clearedReset() {
		return { reset_code_hash: null, reset_code_expires: null, reset_code_sent_at: null, reset_code_attempts: 0 };
	}
}
