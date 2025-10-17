import { IsString, IsOptional, IsArray, IsBoolean, ValidateNested, IsNumber, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class MealLogItemDto {
  @IsString()
  name!: string;

  @IsBoolean()
  taken!: boolean;

  @IsOptional()
  @IsNumber()
  qty?: number;
}

export class ExtraFoodDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsNumber()
  calories?: number;

  @IsOptional()
  @IsNumber()
  protein?: number;

  @IsOptional()
  @IsNumber()
  carbs?: number;

  @IsOptional()
  @IsNumber()
  fat?: number;
}

export class SupplementTakenDto {
  @IsString()
  name!: string;

  @IsBoolean()
  taken!: boolean;
}

export class Time12Dto {
  @IsNumber()
  @Min(1)
  @Max(12)
  hour!: number;

  @IsNumber()
  @Min(0)
  @Max(59)
  minute!: number;

  @IsString()
  ampm!: 'AM' | 'PM';
}

export class LogMealDto {
  @IsString()
  planId!: string;

  @IsString()
  day!: string;

  @IsNumber()
  mealIndex!: number;

  @IsDateString()
  eatenAt!: string;

  @IsNumber()
  @Min(1)
  @Max(5)
  adherence!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsString()
  mealTitle: string;

  @IsBoolean()
  notifyCoach!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MealLogItemDto)
  items!: MealLogItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExtraFoodDto)
  extraFoods!: ExtraFoodDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplementTakenDto)
  supplementsTaken!: SupplementTakenDto[];
}
