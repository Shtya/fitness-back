// src/system-settings/dto/update-system-settings.dto.ts
import { IsOptional, IsObject, IsString, IsBoolean, IsArray } from 'class-validator';

export class UpdateSystemSettingsDto {
  @IsOptional() @IsObject() gym?: Record<string, any>;
  @IsOptional() @IsArray()  loadingMessages?: Array<{ text: string; isShow?: boolean; timeToShow?: number }>;

  @IsOptional() @IsObject() branding?: Record<string, any>;
  @IsOptional() @IsObject() systemColors?: Record<string, string>;

  @IsOptional() @IsObject() pricing?: Record<string, any>;
  @IsOptional() @IsObject() reports?: Record<string, any>;
  @IsOptional() @IsObject() whatsapp?: Record<string, any>;
  @IsOptional() @IsObject() weeklyLogs?: Record<string, any>;
  @IsOptional() @IsObject() podcast?: Record<string, any>;
  @IsOptional() @IsObject() broadcast?: Record<string, any>;
}

export class UpdateSectionDto {
  // whole-section upsert/merge
  @IsObject()
  payload!: Record<string, any>;
}

export class SetTokenDto {
  @IsOptional() @IsString() apiToken?: string;
  @IsOptional() @IsString() whatsappToken?: string;
}

export class ReplaceColorsDto {
  @IsObject()
  systemColors!: Record<string, string>;
}

export class ReplaceLoadingMessagesDto {
  @IsArray()
  loadingMessages!: Array<{ text: string; isShow?: boolean; timeToShow?: number }>;
}

export class ToggleDto {
  @IsBoolean()
  enabled!: boolean;
}
