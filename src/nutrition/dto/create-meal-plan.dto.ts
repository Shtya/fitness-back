import { IsString, IsOptional, IsArray, IsBoolean, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '../../../entities/meal_plans.entity'; // ✅ بدل global.entity

export class MealItemDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsNumber()
  calories!: number;
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
