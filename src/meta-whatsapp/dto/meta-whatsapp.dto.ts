import {
	IsArray,
	IsBoolean,
	IsInt,
	IsObject,
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

export class EditMetaTemplateDto {
	@IsOptional()
	@IsString()
	@MinLength(3)
	category?: string;

	@IsString()
	@MinLength(1)
	bodyText: string;

	@IsOptional()
	@IsString()
	headerFormat?: string;

	@IsOptional()
	@IsString()
	headerText?: string;

	@IsOptional()
	@IsString()
	headerHandle?: string;

	@IsOptional()
	@IsObject()
	existingHeaderComponent?: Record<string, any>;

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

export class CloneMetaTemplatesDto {
	/** Source template names on Meta (default: so7ba_fitness_outreach_ar/en). */
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	names?: string[];

	/** Target category (default UTILITY). */
	@IsOptional()
	@IsString()
	category?: string;

	/** Appended to source name when nameMap has no entry (default _util). */
	@IsOptional()
	@IsString()
	nameSuffix?: string;

	/** Optional explicit new-name map: { sourceName: newName }. */
	@IsOptional()
	@IsObject()
	nameMap?: Record<string, string>;
}

export class CreateFromMetaLibraryDto {
	@IsString()
	@MinLength(3)
	@MaxLength(512)
	name: string;

	@IsString()
	@MinLength(2)
	language: string;

	@IsString()
	@MinLength(1)
	libraryTemplateName: string;

	@IsOptional()
	@IsString()
	category?: string;

	@IsOptional()
	@IsArray()
	libraryTemplateButtonInputs?: any[];

	/** Raw library buttons — used to auto-build button inputs when not provided */
	@IsOptional()
	@IsArray()
	buttons?: any[];

	@IsOptional()
	@IsString()
	buttonUrl?: string;

	@IsOptional()
	@IsString()
	buttonPhone?: string;
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

export class CheckMetaBulkPhonesDto {
	@IsArray()
	@IsString({ each: true })
	phones: string[];
}

export class StartMetaBulkDto {
	/** Load all phones from a Lead Scout job sheet (preferred for full-sheet sends). */
	@IsOptional()
	@IsUUID()
	jobId?: string;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MetaBulkLeadRefDto)
	recipients?: MetaBulkLeadRefDto[];

	@IsString()
	@MinLength(1)
	templateName: string;

	@IsOptional()
	@IsString()
	language?: string;

	/** Static Meta components (used when no per-lead variable map). */
	@IsOptional()
	@IsArray()
	components?: any[];

	/**
	 * Map template placeholders to FitnessLead fields.
	 * Example: { "BODY:1": "businessName", "BODY:2": "city", "BUTTON:0:1": "website" }
	 */
	@IsOptional()
	@IsObject()
	variableMap?: Record<string, string>;

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

export class SetMetaConversationFavoriteDto {
	@IsBoolean()
	isFavorite: boolean;
}

export class CreateMetaQuickReplyDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	title: string;

	@IsString()
	@MinLength(1)
	@MaxLength(4000)
	body: string;
}

export class UpdateMetaQuickReplyDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	title?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(4000)
	body?: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(9999)
	sortOrder?: number;
}

export class TranslateMetaTextDto {
	@IsString()
	@MinLength(1)
	@MaxLength(4500)
	text: string;

	/** Optional override; otherwise Arabic↔English is auto-detected. */
	@IsOptional()
	@IsString()
	targetLang?: 'ar' | 'en';
}
