import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLocale,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  DemoConversationSourceType,
  DemoDeletedMode,
  DemoEventType,
  DemoMessageDirection,
  DemoMessageStatus,
  DemoPresenceStatus,
} from '../entities/whatsapp-demo.entity';

export class DemoFlagsDto {
  @IsOptional() @IsBoolean() useFakeContacts?: boolean;
  @IsOptional() @IsBoolean() useFakeTyping?: boolean;
  @IsOptional() @IsBoolean() useFakeMessages?: boolean;
  @IsOptional() @IsBoolean() overlayRealChats?: boolean;
  @IsOptional() @IsBoolean() randomTyping?: boolean;
  @IsOptional() @IsBoolean() randomDelays?: boolean;
  @IsOptional() @IsBoolean() hideDemoBadge?: boolean;
}

export class UpdateDemoSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsUUID() activeProfileId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => DemoFlagsDto) flags?: DemoFlagsDto;
}

export class CreateDemoProfileDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsLocale() locale?: string;
  @IsOptional() @IsInt() @Min(-2147483648) @Max(2147483647) randomSeed?: number;
}

export class UpdateDemoProfileDto extends PartialType(CreateDemoProfileDto) {}

export class CreateDemoContactDto {
  @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @IsOptional() @IsUUID() photoAttachmentId?: string | null;
  @IsOptional() @IsString() @MaxLength(32) avatarColor?: string | null;
  @IsOptional() @IsPhoneNumber() phone?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) about?: string | null;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsEnum(DemoPresenceStatus) presenceStatus?: DemoPresenceStatus;
  @IsOptional() @IsDateString() lastSeenAt?: string | null;
}

export class UpdateDemoContactDto extends PartialType(CreateDemoContactDto) {}

export class CreateDemoConversationDto {
  @IsEnum(DemoConversationSourceType) sourceType!: DemoConversationSourceType;
  @IsOptional() @IsUUID() contactId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) realAccountId?: string | null;
  @IsOptional() @IsString() @MaxLength(255) realConversationId?: string | null;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsInt() @Min(0) unreadCount?: number;
  @IsOptional() @IsDateString() mutedUntil?: string | null;
  @IsOptional() @IsInt() manualOrder?: number;
  @IsOptional() @IsObject() overrides?: Record<string, unknown>;
}

export class UpdateDemoConversationDto extends PartialType(CreateDemoConversationDto) {}

export class CreateDemoReactionDto {
  @IsString() @Length(1, 32) emoji!: string;
  @IsOptional() @IsString() @MaxLength(160) actorKey?: string;
}

export class CreateDemoMessageDto {
  @IsEnum(DemoMessageDirection) direction!: DemoMessageDirection;
  @IsString() @IsNotEmpty() @MaxLength(40) type!: string;
  @IsOptional() @IsString() @MaxLength(100000) text?: string | null;
  @IsDateString() timestamp!: string;
  @IsOptional() @IsEnum(DemoMessageStatus) status?: DemoMessageStatus;
  @IsOptional() @IsBoolean() showReadReceipt?: boolean;
  @IsOptional() @IsUUID() replyToId?: string | null;
  @IsOptional() @IsBoolean() forwarded?: boolean;
  @IsOptional() @IsDateString() editedAt?: string | null;
  @IsOptional() @IsEnum(DemoDeletedMode) deletedMode?: DemoDeletedMode;
  @IsOptional() @IsObject() location?: Record<string, unknown> | null;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  attachmentIds?: string[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateDemoReactionDto)
  reactions?: CreateDemoReactionDto[];
}

export class UpdateDemoMessageDto extends PartialType(CreateDemoMessageDto) {}

export class CreateDemoEventDto {
  @IsEnum(DemoEventType) eventType!: DemoEventType;
  @IsOptional() @IsUUID() conversationId?: string | null;
  @IsOptional() @IsInt() @Min(0) delayMs?: number;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsInt() @Min(0) durationMs?: number | null;
  @IsOptional() @IsBoolean() infinite?: boolean;
  @IsOptional() @IsBoolean() randomize?: boolean;
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) sequence?: number;
}

export class UpdateDemoEventDto extends PartialType(CreateDemoEventDto) {}
