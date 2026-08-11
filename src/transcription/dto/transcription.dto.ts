import {
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	MinLength,
} from 'class-validator';

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
