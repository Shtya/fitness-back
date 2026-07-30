import {
	IsArray,
	IsBoolean,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SaveMetaWhatsAppConfigDto {
	@IsOptional()
	@IsString()
	@MinLength(10)
	accessToken?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	phoneNumberId?: string;

	@IsOptional()
	@IsString()
	wabaId?: string;

	@IsOptional()
	@IsString()
	@MinLength(8)
	verifyToken?: string;

	@IsOptional()
	@IsString()
	@MinLength(8)
	appSecret?: string;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class SendMetaTextDto {
	@IsOptional()
	@IsUUID()
	leadId?: string;

	@IsOptional()
	@IsString()
	phone?: string;

	@IsOptional()
	@IsUUID()
	conversationId?: string;

	@IsString()
	@MinLength(1)
	text: string;
}

export class SendMetaTemplateDto {
	@IsOptional()
	@IsUUID()
	leadId?: string;

	@IsOptional()
	@IsString()
	phone?: string;

	@IsOptional()
	@IsUUID()
	conversationId?: string;

	@IsString()
	@MinLength(1)
	templateName: string;

	@IsOptional()
	@IsString()
	language?: string;

	@IsOptional()
	@IsArray()
	components?: any[];
}

export class CreateMetaTemplateButtonDto {
	@IsString()
	type: string; // QUICK_REPLY | URL | PHONE_NUMBER

	@IsString()
	@MinLength(1)
	@MaxLength(25)
	text: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	url?: string;

	@IsOptional()
	@IsString()
	@MaxLength(20)
	phone_number?: string;
}

export class CreateMetaTemplateDto {
	@IsString()
	@MinLength(3)
	@MaxLength(512)
	name: string;

	@IsString()
	@MinLength(2)
	language: string;

	@IsString()
	@MinLength(3)
	category: string;

	@IsString()
	@MinLength(1)
	bodyText: string;

	@IsOptional()
	@IsString()
	headerFormat?: string; // NONE | TEXT | IMAGE | VIDEO | DOCUMENT

	@IsOptional()
	@IsString()
	headerText?: string;

	@IsOptional()
	@IsString()
	headerHandle?: string;

	@IsOptional()
	@IsString()
	footerText?: string;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CreateMetaTemplateButtonDto)
	buttons?: CreateMetaTemplateButtonDto[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	exampleBodyParams?: string[];

	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	exampleHeaderParams?: string[];
}

export class MetaBulkLeadRefDto {
	@IsOptional()
	@IsUUID()
	leadId?: string;

	@IsOptional()
	@IsString()
	phone?: string;

	@IsOptional()
	@IsString()
	displayName?: string;
}

export class StartMetaBulkDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MetaBulkLeadRefDto)
	recipients: MetaBulkLeadRefDto[];

	@IsString()
	@MinLength(1)
	templateName: string;

	@IsOptional()
	@IsString()
	language?: string;

	@IsOptional()
	@IsArray()
	components?: any[];

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(60)
	rateLimitPerMinute?: number;
}

export class OpenLeadConversationDto {
	@IsUUID()
	leadId: string;
}

export class OpenMetaPhoneDto {
	@IsString()
	@MinLength(8)
	@MaxLength(32)
	phone: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	displayName?: string;
}
