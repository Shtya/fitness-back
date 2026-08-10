import {
	IsArray,
	IsBoolean,
	IsIn,
	IsObject,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
	ValidateNested,
	ArrayMaxSize,
	ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class LearningAiDto {
	@IsOptional()
	@IsString()
	@MaxLength(64)
	action?: string;

	@IsOptional()
	@IsString()
	@MaxLength(12000)
	prompt?: string;

	@IsOptional()
	@IsString()
	@MaxLength(8)
	locale?: string;

	@IsOptional()
	@IsString()
	@MaxLength(128)
	pathId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(128)
	topicId?: string;

	@IsOptional()
	@IsObject()
	context?: Record<string, any>;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	provider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	model?: string;

	@IsOptional()
	@IsBoolean()
	allowFallback?: boolean;
}

export class LearningFetchUrlDto {
	@IsString()
	@MinLength(4)
	@MaxLength(2000)
	url: string;
}

export class LearningImportUrlDto {
	@IsString()
	@MinLength(4)
	@MaxLength(2000)
	url: string;

	@IsOptional()
	@IsIn(['topic', 'roadmap'])
	mode?: 'topic' | 'roadmap';

	@IsOptional()
	@IsString()
	@MaxLength(500)
	topicTitle?: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	goal?: string;

	@IsOptional()
	@IsString()
	@MaxLength(8)
	locale?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	provider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	model?: string;

	@IsOptional()
	@IsBoolean()
	allowFallback?: boolean;
}

export class LearningRoadmapTopicDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	slug: string;

	@IsString()
	@MinLength(1)
	@MaxLength(120)
	nodeId: string;
}

export class LearningSearchRoadmapsDto {
	@IsString()
	@MinLength(2)
	@MaxLength(200)
	query: string;

	@IsOptional()
	@IsString()
	@MaxLength(8)
	locale?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	provider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	model?: string;

	@IsOptional()
	@IsBoolean()
	allowFallback?: boolean;
}

export class LearningVideoTranscriptDto {
	@IsString()
	@MinLength(4)
	@MaxLength(500)
	url: string;
}

export class LearningTranslateItemDto {
	@IsString()
	@MinLength(1)
	@MaxLength(128)
	id: string;

	@IsString()
	@MinLength(1)
	@MaxLength(20000)
	text: string;
}

export class LearningTranslateDto {
	@IsArray()
	@ArrayMinSize(1)
	@ArrayMaxSize(80)
	@ValidateNested({ each: true })
	@Type(() => LearningTranslateItemDto)
	items: LearningTranslateItemDto[];

	@IsOptional()
	@IsIn(['ar', 'en'])
	targetLang?: 'ar' | 'en';
}
