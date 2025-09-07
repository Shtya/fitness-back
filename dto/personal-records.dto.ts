import {
  IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional,
  IsString, Length, Min, ValidateNested
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class PersonalSetRecordDto {
  @IsOptional() @IsString() id?: string;
  @IsInt() @Min(0) weight!: number;
  @IsInt() @Min(0) reps!: number;
  @IsBoolean() done!: boolean;
  @IsInt() @Min(1) setNumber!: number; // 1-based
}

export class CreatePersonalRecordDto {
  @IsString() @Length(1, 200)
  exerciseName!: string;

  @IsDateString()
  date!: string; // 'YYYY-MM-DD'

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalSetRecordDto)
  records!: PersonalSetRecordDto[];
}

export class UpdatePersonalRecordDto {
  @IsOptional() @IsString() @Length(1, 200)
  exerciseName?: string;

  @IsOptional() @IsDateString()
  date?: string;

  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PersonalSetRecordDto)
  records?: PersonalSetRecordDto[];
}

export class AttemptPrDto {
  // Optional: keep for compatibility if you still call /prs/attempt
  @IsString() @Length(1, 200)
  exerciseName!: string;

  @IsDateString()
  date!: string;

  // Single set to upsert by setNumber (append/replace)
  @ValidateNested()
  @Type(() => PersonalSetRecordDto)
  set!: PersonalSetRecordDto;
}

export class QueryPrDto {
  @IsOptional() @IsString() @Length(1, 200)
  exerciseName?: string;

  @IsOptional() @IsDateString()
  from?: string;

  @IsOptional() @IsDateString()
  to?: string;

  // done now lives inside JSON; we’ll implement JSONB filter when present
  @IsOptional() @IsIn(['true','false'])
  done?: 'true' | 'false';

  @IsOptional() @IsIn(['createdAt','updatedAt','date','exerciseName'])
  sortBy?: 'createdAt'|'updatedAt'|'date'|'exerciseName' = 'updatedAt';

  @IsOptional() @IsIn(['ASC','DESC'])
  sortOrder?: 'ASC'|'DESC' = 'DESC';

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(0)
  offset?: number = 0;

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  limit?: number = 20;
}

export class HistoryQueryDto {
  @IsString() @Length(1, 200)
  exerciseName!: string;

  @IsOptional() @IsIn(['day','week','month'])
  bucket?: 'day'|'week'|'month' = 'week';

  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  windowDays?: number = 90;
}

export class OverviewQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1)
  windowDays?: number = 30;
}
