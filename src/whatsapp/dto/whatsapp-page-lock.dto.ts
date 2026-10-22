import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PAGE_LOCK_AUTO_MINUTES, PAGE_LOCK_MAX_LENGTH, PAGE_LOCK_MIN_LENGTH } from '../utils/whatsapp-page-lock';

export class SetupPageLockDto {
	@IsString()
	@Length(PAGE_LOCK_MIN_LENGTH, PAGE_LOCK_MAX_LENGTH)
	passcode: string;

	@IsOptional()
	@IsIn(PAGE_LOCK_AUTO_MINUTES as unknown as number[])
	autoLockMinutes?: number;
}

export class VerifyPageLockDto {
	@IsString()
	@MaxLength(PAGE_LOCK_MAX_LENGTH)
	passcode: string;
}

export class UpdatePageLockSettingsDto {
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsIn(PAGE_LOCK_AUTO_MINUTES as unknown as number[])
	autoLockMinutes?: number;

	@IsOptional()
	@IsBoolean()
	lockOnHide?: boolean;

	@IsOptional()
	@IsBoolean()
	lockOnOpen?: boolean;

	/** Required only when turning the lock off. */
	@IsOptional()
	@IsString()
	@MaxLength(PAGE_LOCK_MAX_LENGTH)
	passcode?: string;
}

export class ChangePageLockDto {
	@IsString()
	@MaxLength(PAGE_LOCK_MAX_LENGTH)
	currentPasscode: string;

	@IsString()
	@Length(PAGE_LOCK_MIN_LENGTH, PAGE_LOCK_MAX_LENGTH)
	newPasscode: string;
}

export class RemovePageLockDto {
	@IsString()
	@MaxLength(PAGE_LOCK_MAX_LENGTH)
	passcode: string;
}

export class ResetPageLockWithCodeDto {
	@IsString()
	@Length(6, 6)
	code: string;

	@IsString()
	@Length(PAGE_LOCK_MIN_LENGTH, PAGE_LOCK_MAX_LENGTH)
	newPasscode: string;
}

export class ResetPageLockWithAccountPasswordDto {
	@IsString()
	@MaxLength(200)
	accountPassword: string;

	@IsString()
	@Length(PAGE_LOCK_MIN_LENGTH, PAGE_LOCK_MAX_LENGTH)
	newPasscode: string;
}
