import {
	IsArray,
	ArrayNotEmpty,
	IsBoolean,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	Matches,
	MaxLength,
	Min,
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
	@IsIn(['baileys', 'wppconnect'])
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

	/** Explicit UI choice. Restore/reconnect omits this so the last method is kept. */
	@IsOptional()
	@IsIn(['qr', 'pairing_code'])
	mode?: 'qr' | 'pairing_code';
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

export class UpdateWhatsAppNotificationPreferencesDto {
	@IsBoolean()
	notificationsEnabled: boolean;
}

/** Must be declared before SendWhatsAppMessageDto — emitDecoratorMetadata reads the type eagerly. */
export class WhatsAppContactPayloadDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	displayName?: string;

	@IsOptional()
	@IsString()
	@MaxLength(32)
	phoneNumber?: string;

	@IsOptional()
	@IsString()
	@MaxLength(64)
	waId?: string;
}

export class SendWhatsAppMessageDto {
	@IsIn(['text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'contact'])
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

	@IsOptional()
	@ValidateNested()
	@Type(() => WhatsAppContactPayloadDto)
	contact?: WhatsAppContactPayloadDto;
}

export class EditWhatsAppMessageDto {
	@IsString()
	@MaxLength(4096)
	text: string;
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

/** Re-send message content as a fresh outbound message (no WhatsApp "Forwarded" label). */
export class ShareWhatsAppMessagesAsOriginalDto {
	@IsUUID()
	targetConversationId: string;

	@IsArray()
	@ArrayNotEmpty()
	@IsUUID('4', { each: true })
	messageIds: string[];
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

export class CreateWhatsAppMessageGroupDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	name: string;
}

export class RenameWhatsAppMessageGroupDto {
	@IsString()
	@MinLength(1)
	@MaxLength(120)
	name: string;
}

export class WhatsAppMessageGroupMessagesDto {
	@IsArray()
	@ArrayNotEmpty()
	@IsUUID('4', { each: true })
	messageIds: string[];
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

export class CloneWhatsAppVoiceDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(16)
	consent?: string;

	@IsOptional()
	@IsString()
	@MaxLength(64)
	cloneProvider?: string;
}

export class TransformWhatsAppVoiceDto {
	@IsOptional()
	@IsString()
	@MaxLength(64)
	provider?: string;

	@IsOptional()
	@IsString()
	@MaxLength(64)
	preset?: string;

	@IsOptional()
	@IsString()
	@MaxLength(16)
	pitchSemitones?: string;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	voiceId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	apiKey?: string;
}

/*
 * Conversation-flag and presence bodies. These endpoints previously declared
 * inline object types, which makes Nest skip the global ValidationPipe entirely
 * (no metatype to validate against). Field sets match exactly what the dashboard
 * sends, so `forbidNonWhitelisted` cannot reject a legitimate request.
 */

export class OpenWhatsAppConversationDto {
	@IsString()
	@MinLength(1)
	@MaxLength(140)
	chatId: string;

	@IsOptional()
	@IsString()
	@MaxLength(200)
	title?: string;
}

export class SetWhatsAppConversationFavoriteDto {
	@IsOptional()
	@IsBoolean()
	isFavorite?: boolean;
}

export class SetWhatsAppConversationPinnedDto {
	@IsOptional()
	@IsBoolean()
	isPinned?: boolean;
}

export class SetWhatsAppConversationArchivedDto {
	@IsOptional()
	@IsBoolean()
	isArchived?: boolean;
}

export class SetWhatsAppConversationMutedDto {
	@IsOptional()
	@IsBoolean()
	isMuted?: boolean;

	/** Explicit expiry. `@IsOptional` also accepts null, which means "no expiry". */
	@IsOptional()
	@IsString()
	@MaxLength(40)
	mutedUntil?: string | null;

	/** Server derives `mutedUntil` from this when no explicit expiry is sent. */
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	durationMinutes?: number;
}

export class SendWhatsAppPresenceDto {
	@IsOptional()
	@IsIn(['composing', 'recording', 'paused', 'available'])
	state?: 'composing' | 'recording' | 'paused' | 'available';
}

export class DeleteWhatsAppPendingUploadDto {
	@IsString()
	@MinLength(1)
	@MaxLength(400)
	fileId: string;
}

export class ViewWhatsAppStatusDto {
	@IsOptional()
	@IsString()
	@MaxLength(60)
	senderWaId?: string;
}
