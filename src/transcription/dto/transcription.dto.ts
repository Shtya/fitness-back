import {
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from 'class-validator';

const AI_FREE_ENHANCE_PROVIDERS = [
	'llm7-free',
	'pollinations-free',
	'browser-chatgpt',
] as const;

export class CreateTranscriptionDto {
	@IsOptional()
	@IsIn(['local', 'groq', 'deepgram', 'assemblyai'])
	provider?: 'local' | 'groq' | 'deepgram' | 'assemblyai';

	@IsOptional()
	@IsIn(['auto', 'ar', 'en'])
	language?: 'auto' | 'ar' | 'en';

	@IsOptional()
	@IsString()
	@MaxLength(4000)
	customVocabulary?: string;
}

export class UpdateTranscriptionDto {
	@IsString()
	@MaxLength(2_000_000)
	text: string;
}

export class CreateTextTranscriptionDto {
	@IsString()
	@MaxLength(2_000_000)
	text: string;

	@IsOptional()
	@IsString()
	@MaxLength(255)
	originalFileName?: string;

	@IsOptional()
	@IsIn(['auto', 'ar', 'en'])
	language?: 'auto' | 'ar' | 'en';
}

export class SaveProviderCredentialDto {
	@IsString()
	@MinLength(20)
	@MaxLength(512)
	apiKey: string;
}

export class EnhanceTranscriptionDto {
	@IsOptional()
	@IsString()
	@MaxLength(2_000_000)
	text?: string;

	@IsOptional()
	@IsIn(['ar', 'en', 'auto'])
	locale?: 'ar' | 'en' | 'auto';

	@IsOptional()
	@IsIn(['clarity', 'punctuation', 'full'])
	mode?: 'clarity' | 'punctuation' | 'full';

	@IsOptional()
	@IsBoolean()
	apply?: boolean;

	/** Last-known working free AI provider (client may persist in localStorage). */
	@IsOptional()
	@IsIn(AI_FREE_ENHANCE_PROVIDERS)
	provider?: typeof AI_FREE_ENHANCE_PROVIDERS[number];
}

export class MemorizeTranscriptionDto {
	@IsOptional()
	@IsString()
	@MaxLength(2_000_000)
	text?: string;

	@IsOptional()
	@IsIn(['ar', 'en', 'auto'])
	locale?: 'ar' | 'en' | 'auto';

	@IsOptional()
	@IsIn(['short', 'detailed'])
	depth?: 'short' | 'detailed';

	@IsOptional()
	@IsBoolean()
	includeFlashcards?: boolean;
}

export class SummarizeTranscriptionDto {
	@IsOptional()
	@IsString()
	@MaxLength(2_000_000)
	text?: string;

	@IsOptional()
	@IsIn(['ar', 'en', 'auto'])
	locale?: 'ar' | 'en' | 'auto';
}
