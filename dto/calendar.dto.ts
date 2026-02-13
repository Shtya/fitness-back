// src/modules/calendar/calendar.dto.ts
import { IsArray, IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CalendarRecurrence } from '../entities/calendar.entity';
 
// =============== Types DTOs ===============
export class CreateCalendarTypeDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsOptional()
  textColor?: string;

  @IsString()
  @IsOptional()
  border?: string;

  @IsString()
  @IsOptional()
  ring?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateCalendarTypeDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  textColor?: string;

  @IsString()
  @IsOptional()
  border?: string;

  @IsString()
  @IsOptional()
  ring?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// =============== Items DTOs ===============
export class CreateCalendarItemDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  // optional: null means default client-side type
  @IsUUID()
  @IsOptional()
  typeId?: string | null;

  @IsString()
  @IsNotEmpty()
  startDate!: string; // YYYY-MM-DD

  @IsString()
  @IsOptional()
  startTime?: string | null; // "HH:mm"

  @IsEnum(CalendarRecurrence)
  @IsOptional()
  recurrence?: CalendarRecurrence;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  recurrenceInterval?: number;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  recurrenceDays?: number[];
}

export class UpdateCalendarItemDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsUUID()
  @IsOptional()
  typeId?: string | null;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  startTime?: string | null;

  @IsEnum(CalendarRecurrence)
  @IsOptional()
  recurrence?: CalendarRecurrence;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  recurrenceInterval?: number;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  recurrenceDays?: number[];
}

// =============== Completions DTOs ===============
export class ToggleCompletionDto {
  @IsUUID()
  itemId!: string;

  @IsString()
  date!: string; // YYYY-MM-DD

  @IsBoolean()
  @IsOptional()
  completed?: boolean; // if omitted => toggle
}

// =============== Settings DTOs ===============
export class UpdateCalendarSettingsDto {
  @IsBoolean()
  @IsOptional()
  showWeekNumbers?: boolean;

  @IsBoolean()
  @IsOptional()
  highlightWeekend?: boolean;

  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  weekendDays?: number[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  startOfWeek?: number;

  @IsBoolean()
  @IsOptional()
  confirmBeforeDelete?: boolean;
}

// =============== Commitment Timer DTOs ===============
export class StartCommitmentDto {
  // if not provided => start from now
  @IsInt()
  @IsOptional()
  startTimeMs?: number;
}

export class PauseCommitmentDto {
  @IsBoolean()
  @IsOptional()
  isRunning?: boolean; // default false
}
