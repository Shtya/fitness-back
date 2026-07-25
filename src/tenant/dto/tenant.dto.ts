import {
  IsEmail,
  IsOptional,
  IsString,
  IsIn,
  IsInt,
  Min,
  Max,
  MaxLength,
  Matches,
  ValidateIf,
} from 'class-validator';

export class DiscoverTenantByEmailDto {
  @IsEmail()
  email!: string;
}

export class DiscoverTenantByLicenseDto {
  @IsString()
  @MaxLength(64)
  licenseKey!: string;
}

export class UpdateTenantBrandingDto {
  @IsOptional() @IsString() @MaxLength(160) appName?: string;
  @IsOptional() @IsString() @MaxLength(80) shortName?: string;
  @IsOptional() @IsString() @MaxLength(240) tagline?: string;
  @IsOptional() @IsString() @MaxLength(160) companyName?: string;
  @IsOptional() @IsString() @MaxLength(240) supportEmail?: string;
  @IsOptional() @IsString() @MaxLength(64) supportPhone?: string;
  @IsOptional() @IsString() @MaxLength(400) websiteUrl?: string;

  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) primaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) primaryForegroundColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) secondaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) secondaryForegroundColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) accentColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) accentForegroundColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) backgroundColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) surfaceColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) cardColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) textPrimaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) textSecondaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) mutedTextColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) borderColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) dividerColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) successColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) warningColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) dangerColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) infoColor?: string;

  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkPrimaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkBackgroundColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkSurfaceColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkCardColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkTextPrimaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkTextSecondaryColor?: string;
  @IsOptional() @Matches(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/) darkBorderColor?: string;

  @IsOptional() @IsString() @MaxLength(80) fontFamily?: string;
  @IsOptional() @IsString() @MaxLength(80) arabicFontFamily?: string;
  @IsOptional() @IsInt() @Min(0) @Max(48) borderRadius?: number;
  @IsOptional() @IsInt() @Min(0) @Max(48) buttonRadius?: number;
  @IsOptional() @IsInt() @Min(0) @Max(48) cardRadius?: number;
  @IsOptional() @IsIn(['light', 'dark', 'system']) themeMode?: 'light' | 'dark' | 'system';
  @IsOptional() @IsString() @MaxLength(40) paletteKey?: string;
}

export class CreateTenantDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(120) slug?: string;
  @IsOptional() @IsString() @MaxLength(255) primaryDomain?: string;
  @IsOptional() @IsString() ownerUserId?: string;
  @IsOptional() @IsInt() @Min(1) maxDevices?: number;
}

export class LoginWithTenantDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsOptional()
  @IsString()
  discoveryToken?: string;

  @IsOptional()
  @IsString()
  tenantId?: string;
}
