import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength, IsEnum, IsInt, Min } from 'class-validator';
import { UserRole } from 'entities/global.entity';

export class RegisterDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(6) password!: string;
  @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @IsOptional() @IsInt() @Min(0) defaultRestSeconds?: number;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class RefreshDto {
  @IsString()
  refreshToken!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultRestSeconds?: number;

  // UUID but optional — keep string to avoid coupling if you ever change type
  @IsOptional()
  @IsString()
  activePlanId?: string | null;
}

export class PagedQueryDto {
  @IsOptional() page?: number;
  @IsOptional() limit?: number;
}

export class ForgotPasswordDto {
  @IsEmail() email!: string;
}

/* NEW */
export class ResetPasswordDto {
  @IsEmail() email!: string;
  @IsString() otp!: string; // the code sent/stored
  @IsString() @MinLength(6) newPassword!: string;
}
