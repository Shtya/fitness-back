import {
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PhoneReportCategory } from '../entities/phone-intelligence.entity';

export class LookupPhoneDto {
	@IsString()
	@IsNotEmpty()
	@MinLength(4)
	@MaxLength(32)
	phone: string;

	@IsOptional()
	@IsString()
	@MaxLength(8)
	countryCode?: string;

	/** Force refresh and skip cache */
	@IsOptional()
	@IsBoolean()
	@Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
	refresh?: boolean;
}

export class CreatePhoneReportDto {
	@IsString()
	@IsNotEmpty()
	@MinLength(4)
	@MaxLength(32)
	phone: string;

	@IsOptional()
	@IsString()
	@MaxLength(8)
	countryCode?: string;

	@IsEnum(PhoneReportCategory)
	category: PhoneReportCategory;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	comment?: string;
}

export class DisputeMatchDto {
	@IsString()
	@IsNotEmpty()
	matchId: string;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	reason?: string;
}

export class SavePhoneProviderCredentialDto {
	@IsObject()
	fields: Record<string, string>;
}

export class AnalyzePhoneReportDto {
	@IsOptional()
	@IsString()
	@MaxLength(8)
	locale?: string;

	/** Full or partial enrichment result to analyze */
	@IsObject()
	report: Record<string, unknown>;
}

export class UpsertPhoneSearchSiteDto {
	@IsString()
	@IsNotEmpty()
	@MaxLength(120)
	name: string;

	@IsString()
	@IsNotEmpty()
	@MaxLength(1024)
	urlTemplate: string;

	@IsOptional()
	@IsString()
	@MaxLength(255)
	domain?: string;

	@IsOptional()
	@IsString()
	mode?: 'engine' | 'url' | 'manual';

	@IsOptional()
	@IsBoolean()
	@Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
	enabled?: boolean;

	@IsOptional()
	@IsBoolean()
	@Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
	needsLogin?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	notes?: string;

	@IsOptional()
	@IsInt()
	sortOrder?: number;
}
