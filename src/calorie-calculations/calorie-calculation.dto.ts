import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

class CalorieTargetsDto {
	@IsNumber()
	caloriesTarget: number;

	@IsNumber()
	proteinPerDay: number;

	@IsNumber()
	carbsPerDay: number;

	@IsNumber()
	fatsPerDay: number;

	@IsNumber()
	FiberTarget: number;

	@IsString()
	@MaxLength(32)
	activityLevel: string;
}

export class CreateCalorieCalculationDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	name: string;

	@IsIn(['male', 'female'])
	sex: 'male' | 'female';

	@Type(() => Number)
	@IsNumber()
	@Min(1)
	@Max(120)
	age: number;

	@Type(() => Number)
	@IsNumber()
	@Min(50)
	@Max(260)
	height: number;

	@Type(() => Number)
	@IsNumber()
	@Min(20)
	@Max(400)
	weight: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@Max(70)
	bodyFat?: number | null;

	@IsString()
	@MaxLength(16)
	activity: string;

	@IsString()
	@MaxLength(8)
	goal: string;

	@ValidateNested()
	@Type(() => CalorieTargetsDto)
	targets: CalorieTargetsDto;
}
