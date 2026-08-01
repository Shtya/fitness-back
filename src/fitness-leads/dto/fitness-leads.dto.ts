import {
	IsArray,
	IsBoolean,
	IsInt,
	IsObject,
	IsOptional,
	IsString,
	Max,
	Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StartFitnessLeadsJobDto {
	@IsString()
	countryKey: string;

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	cities?: string[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	categories?: string[];

	@IsOptional()
	@IsBoolean()
	enrichWebsites?: boolean;

	@IsOptional()
	@IsBoolean()
	useOsm?: boolean;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(5)
	@Max(1000)
	maxPlaces?: number;
}

export class SaveFitnessCredentialDto {
	@IsObject()
	fields: Record<string, string>;
}

export class SuggestKeywordsDto {
	@IsString()
	intent: string;

	@IsOptional()
	@IsString()
	locale?: string;

	@IsOptional()
	@IsString()
	countryKey?: string;
}
