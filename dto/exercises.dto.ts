// src/plan-exercises/dto/create-plan-exercise.dto.ts
import { IsArray, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
 import { PartialType } from '@nestjs/mapped-types';
import { ExerciseStatus } from 'entities/global.entity';
import { Type } from 'class-transformer';

export class CreatePlanExerciseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  targetReps: string; // keep UI compatibility

  @IsOptional()
  @IsString()
  @MaxLength(512)
  img?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  video?: string | null;

  @IsOptional()
  @IsString()
  desc?: string | null;

  @IsArray()
  @IsString({ each: true })
  primaryMuscles: string[] = [];

  @IsArray()
  @IsString({ each: true })
  secondaryMuscles: string[] = [];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  equipment?: string | null;

  @IsInt()
  @Min(0)
  orderIndex: number = 0;

  @IsInt()
  @Min(0)
  targetSets: number = 3;

  @IsInt()
  @Min(0)
  restSeconds: number = 90;

  @IsArray()
  @IsString({ each: true })
  alternatives: string[] = [];

  @IsEnum(ExerciseStatus)
  status: ExerciseStatus = ExerciseStatus.ACTIVE;

  // optional: assign to a day by id (if you accept it in this endpoint)
  @IsOptional()
  @IsString()
  dayId?: string;
}
export class UpdatePlanExerciseDto extends PartialType(CreatePlanExerciseDto) {}

export class SetStatusDto {
  @IsEnum(ExerciseStatus)
  status: ExerciseStatus;
}
 


export class BulkCreatePlanExerciseDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePlanExerciseDto)
  items: CreatePlanExerciseDto[];
}





// src/dto/exercises.dto.ts
export class CreatePlanExercisesDto {
  name: string;
  targetSets?: number;   // default 3
  targetReps: string;    // e.g. "8" or "12-15"
  rest?: number;         // default 90 (seconds)
  tempo?: string | null; // e.g. "1/1/1"
  img?: string | null;   // relative URL or null
  video?: string | null; // relative URL or null
}

export class UpdatePlanExercisesDto {
  name?: string;
  targetSets?: number;
  targetReps?: string;
  rest?: number;
  tempo?: string | null;
  img?: string | null;
  video?: string | null;
}

export class BulkCreatePlanExercisesDto {
  items: CreatePlanExercisesDto[];
}
