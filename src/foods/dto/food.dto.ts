import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { FOOD_BASE_UNITS, FOOD_CATEGORIES, FOOD_SOURCES } from '../../../entities/foods.entity';

export class CreateFoodDto {
	@IsOptional()
	@IsString()
	@MaxLength(200)
	nameAr?: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	nameEn?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	aliases?: string;

	@IsOptional()
	@IsIn(FOOD_CATEGORIES as unknown as string[])
	category?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	brand?: string;

	@IsOptional()
	@IsString()
	@MaxLength(64)
	barcode?: string;

	@IsOptional()
	@IsIn(FOOD_BASE_UNITS as unknown as string[])
	baseUnit?: 'g' | 'ml';

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	kcal!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	protein!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	carbs!: number;

	@Type(() => Number)
	@IsNumber()
	@Min(0)
	fat!: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	fiber?: number | null;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	sugar?: number | null;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	saturatedFat?: number | null;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	sodiumMg?: number | null;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	pieceGrams?: number | null;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	pieceLabelAr?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	pieceLabelEn?: string;

	@IsOptional()
	@IsIn(FOOD_SOURCES as unknown as string[])
	source?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	sourceRef?: string;

	/** Only honoured for super admins. */
	@IsOptional()
	@IsBoolean()
	verified?: boolean;
}

export class UpdateFoodDto extends PartialType(CreateFoodDto) {}
