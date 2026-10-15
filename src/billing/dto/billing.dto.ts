import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsIn,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from 'class-validator';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const RECORDABLE_METHODS = ['cash', 'bank_transfer', 'card', 'wallet', 'other'] as const;
export const PLAN_INTERVALS = ['monthly', 'quarterly', 'yearly', 'one_time'] as const;

export class RecordPaymentDto {
	@IsUUID()
	userId!: string;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0.01)
	@Max(10_000_000)
	amount!: number;

	@IsOptional()
	@IsIn(RECORDABLE_METHODS as unknown as string[])
	method?: string;

	@IsOptional()
	@IsUUID()
	planId?: string;

	@IsOptional()
	@Matches(YMD)
	paidAt?: string;

	@IsOptional()
	@Matches(YMD)
	periodFrom?: string;

	@IsOptional()
	@Matches(YMD)
	periodTo?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	notes?: string;
}

export class CreatePlanDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	name!: string;

	@Type(() => Number)
	@IsNumber({ maxDecimalPlaces: 2 })
	@Min(0)
	@Max(10_000_000)
	price!: number;

	@IsIn(PLAN_INTERVALS as unknown as string[])
	interval!: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(60)
	intervalCount?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(3650)
	durationDays?: number | null;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	description?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(200, { each: true })
	features?: string[];
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
