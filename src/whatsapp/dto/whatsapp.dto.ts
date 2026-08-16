import {
	IsArray,
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	MinLength,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWhatsAppAccountDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	label: string;

	@IsOptional()
	@IsIn(['wppconnect'])
	providerName?: string;
}

export class ConnectWhatsAppAccountDto {
	/** Full international number (digits, optional leading +). Omit to fall back to QR. */
	@IsOptional()
	@IsString()
	@Matches(/^\+?[1-9]\d{6,14}$/, {
		message: 'phoneNumber must be a valid international number, e.g. +201234567890',
	})
	phoneNumber?: string;
}

export class WhatsAppAccountAccessItemDto {
	@IsUUID()
	userId: string;

	@IsBoolean()
	canView: boolean;

	@IsBoolean()
	canUse: boolean;

	@IsBoolean()
	canManage: boolean;

	@IsBoolean()
	canAssign: boolean;

	@IsBoolean()
	canTransfer: boolean;
}

export class UpdateWhatsAppAccountAccessDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => WhatsAppAccountAccessItemDto)
	access: WhatsAppAccountAccessItemDto[];
}

export class UpdateWhatsAppPrivacySettingsDto {
	@IsBoolean()
	hideStatusViewReceipts: boolean;

	@IsIn(['on_open', 'on_reply', 'manual', 'never'])
	readReceiptMode: 'on_open' | 'on_reply' | 'manual' | 'never';
}

export class SendWhatsAppMessageDto {
	@IsIn(['text', 'image', 'video', 'audio', 'voice', 'document', 'sticker'])
	type: string;

	@IsOptional()
	@IsString()
	text?: string;

	@IsOptional()
	@IsString()
	fileId?: string;

	@IsOptional()
	@IsString()
	caption?: string;

	@IsOptional()
	@IsString()
	quotedProviderMessageId?: string;

	@IsOptional()
	@IsString()
	clientMessageId?: string;
}

export class ReactWhatsAppMessageDto {
	@IsOptional()
	@IsString()
	@MaxLength(16)
	emoji?: string;
}

export class ForwardWhatsAppMessageDto {
	@IsUUID()
	targetConversationId: string;
}

export class ToggleWhatsAppMessageDto {
	@IsBoolean()
	enabled: boolean;
}

export class DeleteWhatsAppMessageDto {
	@IsIn(['local', 'everyone'])
	mode: 'local' | 'everyone';
}

export class AssignWhatsAppConversationDto {
	@IsOptional()
	@IsUUID()
	userId?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	note?: string;
}

export class CreateWhatsAppConversationNoteDto {
	@IsString()
	@MinLength(1)
	@MaxLength(2000)
	text: string;
}

export class PublishWhatsAppStatusDto {
	@IsIn(['text', 'image', 'video'])
	type: string;

	@IsString()
	content: string;

	@IsOptional()
	@IsString()
	caption?: string;
}

export class SaveWhatsAppVoiceChangerSettingsDto {
	@IsOptional()
	@IsBoolean()
	configured?: boolean;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(32)
	provider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(40)
	preset?: string;

	@IsOptional()
	@Type(() => Number)
	pitchSemitones?: number;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	voiceId?: string;
}

export class SaveWhatsAppVoiceChangerCredentialDto {
	@IsString()
	@MinLength(8)
	@MaxLength(500)
	apiKey: string;
}
