import { IsArray, IsBoolean, IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

import { Type } from 'class-transformer';

export class UpsertDailyPrRecordDto {
  @IsOptional() @IsString() id?: string; // existing SessionSet id
  @IsInt() @Min(1) setNumber!: number;
  @IsNumber() @Min(0) weight!: number;
  @IsInt() @Min(0) reps!: number;
  @IsBoolean() done!: boolean;
}

export class UpsertDailyPrDto {
  @IsString() @IsNotEmpty() exerciseName!: string;
  @IsDateString() date!: string; // YYYY-MM-DD
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertDailyPrRecordDto)
  records!: UpsertDailyPrRecordDto[];
}
