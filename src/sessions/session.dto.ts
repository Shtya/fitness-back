 import { IsArray, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateSessionDto {
  @IsDateString()
  date!: string; // "YYYY-MM-DD"

  @IsString()
  name!: string;

  @IsOptional() @IsString() planId?: string;

  @IsInt() @Min(0) volume!: number;
  @IsString() duration!: string; // "00:48"

  @IsInt() @Min(0) setsDone!: number;
  @IsInt() @Min(0) setsTotal!: number;

  @IsArray()
  performedSets!: Array<{ exName: string; set: number; weight: number; reps: number; pr: boolean }>;
}
