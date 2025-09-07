// src/workouts/dto/seed-plan.dto.ts
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { WeeklyProgramSeed } from 'entities/global.entity';

export class SeedPlanDto {
  @IsString()
  planName!: string;

  @IsString()
  userId!: string; // العميل

  @IsOptional()
  @IsString()
  coachId?: string | null;

  weekly!: WeeklyProgramSeed;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
// src/workouts/dto/update-exercise.dto.ts

export class UpdateExerciseDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() desc?: string;
  @IsOptional() @IsInt() @Min(0) targetSets?: number;
  @IsOptional() @IsString() targetReps?: string;
  @IsOptional() @IsInt() @Min(0) restSeconds?: number | null;
  @IsOptional() @IsString() img?: string | null;
  @IsOptional() @IsString() video?: string | null;
  @IsOptional() @IsArray() gallery?: string[];
  @IsOptional() @IsInt() @Min(0) sort?: number;
}
// src/workouts/dto/activate-plan.dto.ts
export class ActivatePlanDto {
  @IsBoolean()
  active!: boolean;
}
