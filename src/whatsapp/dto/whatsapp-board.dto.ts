import {
	IsArray,
	IsBoolean,
	IsISO8601,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BoardLabelDto {
	@IsString()
	id: string;

	@IsString()
	@MaxLength(80)
	name: string;

	@IsString()
	@MaxLength(32)
	color: string;
}

export class BoardChecklistItemDto {
	@IsString()
	id: string;

	@IsString()
	@MaxLength(500)
	text: string;

	@IsBoolean()
	completed: boolean;
}

export class CreateBoardColumnDto {
	@IsString()
	@MaxLength(120)
	name: string;

	@IsOptional()
	@IsString()
	@MaxLength(32)
	color?: string;
}

export class UpdateBoardColumnDto {
	@IsOptional()
	@IsString()
	@MaxLength(120)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(32)
	color?: string;

	@IsOptional()
	orderIndex?: number;
}

export class ReorderBoardColumnsDto {
	@IsArray()
	@IsUUID('4', { each: true })
	columnIds: string[];
}

export class CreateBoardCardDto {
	@IsString()
	@MaxLength(500)
	title: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsUUID()
	columnId: string;

	@IsOptional()
	@IsUUID()
	conversationId?: string;

	@IsOptional()
	@IsUUID()
	assignedUserId?: string;

	@IsOptional()
	@IsISO8601()
	dueAt?: string;
}

export class UpdateBoardCardDto {
	@IsOptional()
	@IsString()
	@MaxLength(500)
	title?: string;

	@IsOptional()
	@IsString()
	description?: string;

	@IsOptional()
	@IsUUID()
	columnId?: string;

	@IsOptional()
	orderIndex?: number;

	@IsOptional()
	@IsUUID()
	conversationId?: string | null;

	@IsOptional()
	@IsUUID()
	assignedUserId?: string | null;

	@IsOptional()
	@IsISO8601()
	dueAt?: string | null;

	@IsOptional()
	@IsBoolean()
	isStarred?: boolean;

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => BoardLabelDto)
	labels?: BoardLabelDto[];

	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => BoardChecklistItemDto)
	checklist?: BoardChecklistItemDto[];

	@IsOptional()
	@IsArray()
	comments?: Array<Record<string, unknown>>;

	@IsOptional()
	@IsArray()
	attachments?: Array<Record<string, unknown>>;

	@IsOptional()
	@IsString()
	coverImageUrl?: string | null;
}

export class MoveBoardCardDto {
	@IsUUID()
	columnId: string;

	@IsOptional()
	orderIndex?: number;
}

export class ReorderBoardCardsDto {
	@IsUUID()
	columnId: string;

	@IsArray()
	@IsUUID('4', { each: true })
	cardIds: string[];
}

export class CreateBoardCardFromMessagesDto {
	@IsUUID()
	conversationId: string;

	@IsArray()
	@IsUUID('4', { each: true })
	messageIds: string[];

	@IsOptional()
	@IsUUID()
	columnId?: string;

	@IsOptional()
	@IsString()
	@MaxLength(500)
	title?: string;
}
