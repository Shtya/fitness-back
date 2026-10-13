import {
	ArrayMaxSize,
	ArrayNotEmpty,
	IsArray,
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	IsUUID,
	Length,
	Matches,
	MaxLength,
} from 'class-validator';

/** ISO 3166-1 alpha-2, used only when the number has no `+`/`00` prefix. */
const COUNTRY = /^[A-Za-z]{2}$/;
const COUNTRY_MESSAGE = 'defaultCountry must be a two-letter country code';

export class LookupWhatsAppNumberDto {
	@IsString()
	@Length(3, 40)
	phone: string;

	@IsOptional()
	@Matches(COUNTRY, { message: COUNTRY_MESSAGE })
	defaultCountry?: string;
}

export class CreateWhatsAppContactDto {
	@IsString()
	@Length(3, 40)
	phone: string;

	@IsString()
	@Length(1, 200)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	notes?: string;

	@IsOptional()
	@Matches(COUNTRY, { message: COUNTRY_MESSAGE })
	defaultCountry?: string;

	/** Also write it into the linked WhatsApp account's contact list. */
	@IsOptional()
	@IsBoolean()
	syncToWhatsApp?: boolean;

	@IsOptional()
	@IsIn(['manual', 'lookup'])
	source?: 'manual' | 'lookup';
}

export class UpdateWhatsAppContactDto {
	@IsOptional()
	@IsString()
	@Length(1, 200)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	notes?: string | null;

	@IsOptional()
	@IsBoolean()
	syncToWhatsApp?: boolean;
}

export class MergeWhatsAppContactsDto {
	@IsArray()
	@ArrayNotEmpty()
	@ArrayMaxSize(20)
	@IsUUID('all', { each: true })
	duplicateIds: string[];
}

export class StartWhatsAppContactChatDto {
	@IsOptional()
	@IsUUID()
	contactId?: string;

	@IsOptional()
	@IsString()
	@Length(3, 40)
	phone?: string;

	@IsOptional()
	@Matches(COUNTRY, { message: COUNTRY_MESSAGE })
	defaultCountry?: string;
}