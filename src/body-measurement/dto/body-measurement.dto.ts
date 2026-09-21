import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

function toNullableNumber({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === '') return null;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

export class SaveBodyMeasurementDto {
	@IsDateString()
	date: string;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	@Min(100)
	@Max(230)
	height?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	shoulderWidth?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	chest?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	waist?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	hips?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	upperArm?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	arms?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	thigh?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	thighs?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	inseam?: number | null;

	@IsOptional()
	@Transform(toNullableNumber)
	@IsNumber()
	weight?: number | null;

	@IsOptional()
	@IsString()
	unit?: string;

	@IsOptional()
	@IsString()
	source?: string;

	@IsOptional()
	@IsObject()
	confidence?: Record<string, number | null>;

	@IsOptional()
	@Type(() => Boolean)
	@IsBoolean()
	replaceExisting?: boolean;
}
