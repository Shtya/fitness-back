import { Type } from 'class-transformer';
import {
	IsBoolean,
	IsIn,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';

export class AiGenerateTextDto {
	@IsString()
	@MaxLength(32000)
	prompt: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	model?: string;

	@IsOptional()
	@IsString()
	@MaxLength(8000)
	system?: string;

	@IsOptional()
	@IsNumber()
	@Min(1)
	@Max(8192)
	maxTokens?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(2)
	temperature?: number;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	feature?: string;
}

export class AiGenerateImageDto {
	@IsString()
	@MaxLength(8000)
	prompt: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	model?: string;

	@IsOptional()
	@IsString()
	@MaxLength(16)
	aspectRatio?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	feature?: string;
}

export class SaveAiCredentialDto {
	@IsString()
	@MaxLength(512)
	apiKey: string;
}

export class AiModelPricingDto {
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(100000)
	inputPerMillion?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(100000)
	outputPerMillion?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1000)
	imagePerUnit?: number;
}

export class UpsertAiModelDto {
	@IsString()
	@MaxLength(120)
	modelKey: string;

	@IsString()
	@MaxLength(160)
	name: string;

	@IsString()
	@MaxLength(40)
	provider: string;

	@IsIn(['text', 'image', 'audio'])
	type: 'text' | 'image' | 'audio';

	@IsOptional()
	@ValidateNested()
	@Type(() => AiModelPricingDto)
	pricing?: AiModelPricingDto;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsBoolean()
	isDefault?: boolean;

	@IsOptional()
	@IsIn(['default', 'premium', 'custom'])
	tier?: 'default' | 'premium' | 'custom';
}

export class UpdateAiModelDto {
	@IsOptional()
	@IsString()
	@MaxLength(160)
	name?: string;

	@IsOptional()
	@ValidateNested()
	@Type(() => AiModelPricingDto)
	pricing?: AiModelPricingDto;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsBoolean()
	isDefault?: boolean;
}

export class UpdateAiLimitsDto {
	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1_000_000)
	monthlyCostLimit?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1_000_000)
	monthlyRequestLimit?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1_000_000)
	monthlyImageLimit?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(50)
	safetyBufferPercent?: number;

	@IsOptional()
	@IsBoolean()
	warningsEnabled?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	timezone?: string;
}

export class UpdateAiFeatureDto {
	@IsString()
	@MaxLength(80)
	feature: string;

	@IsString()
	@MaxLength(120)
	modelKey: string;
}

export class UpdateAiProviderLimitsDto {
	@IsString()
	@MaxLength(40)
	provider: string;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1_000_000)
	monthlyCostLimit?: number;

	@IsOptional()
	@IsNumber()
	@Min(0)
	@Max(1_000_000)
	monthlyRequestLimit?: number;
}
