import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export class TrackerBalanceDto {
	@IsIn(['set', 'add', 'subtract'])
	mode!: 'set' | 'add' | 'subtract';

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	@Max(1_000_000_000)
	amount!: number;
}

export class CreateTrackerItemDto {
	@IsString()
	@MinLength(1)
	@MaxLength(180)
	name!: string;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	@Max(100_000_000)
	amount!: number;

	@IsOptional()
	@Matches(YMD)
	date?: string;

	@IsOptional()
	@IsBoolean()
	received?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	notes?: string;
}

export class CreateGoldHoldingDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	name?: string;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 3 })
	@Min(0.001)
	@Max(1_000_000)
	grams!: number;

	@Type(() => Number)
	@IsIn([24, 22, 21, 18])
	karat!: number;
}

export class UpdateGoldHoldingDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	name?: string;

	@IsOptional()
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 3 })
	@Min(0.001)
	@Max(1_000_000)
	grams?: number;

	@IsOptional()
	@Type(() => Number)
	@IsIn([24, 22, 21, 18])
	karat?: number;
}

export class UpdateTrackerItemDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(180)
	name?: string;

	@IsOptional()
	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	@Max(100_000_000)
	amount?: number;

	@IsOptional()
	@Matches(YMD)
	date?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	notes?: string;
}
