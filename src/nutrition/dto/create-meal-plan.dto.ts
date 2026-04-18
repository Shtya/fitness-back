import { IsString, IsOptional, IsArray, IsBoolean, ValidateNested, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '../../../entities/meal_plans.entity'; // ✅ بدل global.entity

export class AlternativeItemDto {
	@IsString()
	name!: string;

	@IsOptional()
	@IsIn(['food', 'recipe'])
	type?: 'food' | 'recipe';

	@IsOptional()
	@IsString()
	id?: string;

	@IsOptional()
	@IsString()
	sourceId?: string;

	@IsOptional()
	@IsNumber()
	quantity?: number;

	@IsOptional()
	@IsIn(['g', 'count', 'mg', 'pcs', 'piece'])
	unit?: string;

	@IsNumber()
	calories!: number;
}

export class MealItemDto {
	@IsString()
	name!: string;

	@IsOptional()
	@IsIn(['food', 'recipe'])
	type?: 'food' | 'recipe';

	@IsOptional()
	@IsString()
	id?: string;

	@IsOptional()
	@IsString()
	sourceId?: string;

	@IsOptional()
	@IsNumber()
	quantity?: number;

	@IsOptional()
	@IsIn(['g', 'mg', 'count', 'pcs', 'piece'])
	unit?: string;

	@IsNumber()
	calories!: number;

	@IsOptional()
	@ValidateNested()
	@Type(() => AlternativeItemDto)
	alternative?: AlternativeItemDto;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => AlternativeItemDto)
	alternatives?: AlternativeItemDto[];
}

export class SupplementDto {
	@IsString()
	name!: string;

	@IsOptional()
	@IsString()
	time?: string;

	// ✅ timing optional (frontend مش بيبعت)
	@IsOptional()
	@IsString()
	timing?: string;

	@IsOptional()
	@IsString()
	bestWith?: string;
}

export class MealDto {
	@IsString()
	title!: string;

	@IsOptional()
	@IsString()
	time?: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MealItemDto)
	items!: MealItemDto[];

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => SupplementDto)
	supplements!: SupplementDto[];
}

export class DayOverrideDto {
	@IsString()
	day!: DayOfWeek;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MealDto)
	meals!: MealDto[];

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => SupplementDto)
	supplements!: SupplementDto[];
}

export class CreateMealPlanDto {
	@IsString()
	name!: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsString()
	notes?: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MealDto)
	baseMeals!: MealDto[];

	@IsOptional()
	@IsBoolean()
	customizeDays?: boolean;

	@IsOptional()
	dayOverrides?: Record<DayOfWeek, DayOverrideDto>;
}
