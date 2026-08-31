import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { AiFreeProviderName } from "../providers/ai-free-provider";

export const AI_FREE_PROVIDERS = [
  "llm7-free",
  "browser-chatgpt",
  "pollinations-free",
] as const;

export class AiFreeChatMessageDto {
  @IsIn(["system", "user", "assistant"])
  role: "system" | "user" | "assistant";

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content: string;
}

export class AiFreeChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => AiFreeChatMessageDto)
  messages: AiFreeChatMessageDto[];

  @IsOptional()
  @IsIn(AI_FREE_PROVIDERS)
  provider?: AiFreeProviderName;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model?: string;

  @IsOptional()
  @IsBoolean()
  allowFallback?: boolean;

  @IsOptional()
  @IsBoolean()
  useProjectKnowledge?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  feature?: string;

  /** Internal / advanced: skip slow or unsuitable providers for this request. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(AI_FREE_PROVIDERS, { each: true })
  excludeProviders?: AiFreeProviderName[];

  @IsOptional()
  maxTokens?: number;

  /** Per-request HTTP timeout for provider calls (enhance uses a shorter budget). */
  @IsOptional()
  httpTimeoutMs?: number;
}

export class AiFreeTitleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  locale?: string;

  @IsOptional()
  @IsIn(AI_FREE_PROVIDERS)
  provider?: AiFreeProviderName;
}
