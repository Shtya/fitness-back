import {
	ArrayMaxSize,
	ArrayMinSize,
	ArrayNotEmpty,
	IsArray,
	IsDateString,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	MinLength,
} from 'class-validator';

export class CreateWhatsAppMessageScheduleDto {
	@IsOptional()
	@IsString()
	@MaxLength(160)
	title?: string;

	@IsIn(['text', 'image', 'video', 'audio', 'voice', 'document', 'sticker'])
	type: string;

	@IsOptional()
	@IsString()
	@MaxLength(5000)
	text?: string;

	@IsOptional()
	@IsString()
	@MaxLength(5000)
	caption?: string;

	@IsOptional()
	@IsString()
	@MaxLength(1024)
	fileId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(128)
	quotedProviderMessageId?: string;

	@ArrayNotEmpty()
	@ArrayMinSize(1)
	@ArrayMaxSize(50)
	@IsArray()
	@IsUUID('4', { each: true })
	conversationIds: string[];

	@IsIn(['once', 'recurring'])
	scheduleKind: 'once' | 'recurring';

	@IsOptional()
	@IsDateString()
	scheduledAt?: string;

	@IsOptional()
	@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
	timeOfDay?: string;

	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	daysOfWeek?: number[];

	@IsOptional()
	@IsDateString()
	recurrenceStartDate?: string;

	@IsOptional()
	@IsDateString()
	recurrenceEndDate?: string;

	@IsOptional()
	@IsString()
	@MaxLength(64)
	timezone?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	clientMessageId?: string;
}

export class UpdateWhatsAppMessageScheduleDto {
	@IsOptional()
	@IsString()
	@MaxLength(160)
	title?: string;

	@IsOptional()
	@IsString()
	@MaxLength(5000)
	text?: string;

	@IsOptional()
	@IsDateString()
	scheduledAt?: string;

	@IsOptional()
	@Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
	timeOfDay?: string;

	@IsOptional()
	@IsArray()
	@IsInt({ each: true })
	daysOfWeek?: number[];

	@IsOptional()
	@IsDateString()
	recurrenceEndDate?: string | null;
}
