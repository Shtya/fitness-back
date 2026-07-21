import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  AI_REPLY_LANGUAGES,
  AI_REPLY_PROVIDERS,
  AI_REPLY_TONES,
  AiReplyLanguage,
  AiReplyProviderName,
  AiReplyTone,
} from "../entities/whatsapp-ai-settings.entity";

export class AiReplyPromptPresetDto {
  @IsUUID()
  id: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  prompt: string;
}

export class UpdateAiReplySettingsDto {
  @IsBoolean()
  enabled: boolean;

  @IsIn(AI_REPLY_PROVIDERS)
  provider: AiReplyProviderName;

  @IsString()
  @MaxLength(80)
  model: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  systemPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiReplyPromptPresetDto)
  promptPresets?: AiReplyPromptPresetDto[];

  @IsOptional()
  @IsUUID()
  activePromptId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  persona?: string | null;

  @IsIn(AI_REPLY_LANGUAGES)
  language: AiReplyLanguage;

  @IsIn(AI_REPLY_TONES)
  tone: AiReplyTone;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  suggestionCount: number;

  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(50)
  contextMessageLimit: number;
}

export class GenerateAiReplySuggestionsDto {
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  @IsOptional()
  @IsUUID()
  contextThroughMessageId?: string;
}

export class TestAiReplyMessageDto {
  @IsIn(["customer", "agent"])
  role: "customer" | "agent";

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content: string;
}

export class TestAiReplyProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  customerMessage?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TestAiReplyMessageDto)
  messages?: TestAiReplyMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  suggestionCount?: number;
}
