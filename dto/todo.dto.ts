// src/todo/todo.dto.ts
import {
	IsArray,
	IsBoolean,
	IsDateString,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	IsUUID,
	MaxLength,
	Min,
	ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TodoPriority, TodoRepeat, TodoStatus } from 'entities/todo.entity';

export class TodoAttachmentDto {
	@IsString() @MaxLength(255)
	name!: string;

	@IsString() @MaxLength(1000)
	url!: string;

	@IsString() @MaxLength(80)
	type!: string;

	@IsOptional() @IsInt() @Min(0)
	size?: number;
}

/* =========================
 * Folder DTOs
 * ========================= */
export class CreateTodoFolderDto {
	@IsString() @MaxLength(140)
	name!: string;

	@IsOptional() @IsString() @MaxLength(40)
	color?: string;

	@IsOptional() @IsString() @MaxLength(60)
	icon?: string;

	@IsOptional() @IsBoolean()
	isSystem?: boolean;
}

export class UpdateTodoFolderDto {
	@IsOptional() @IsString() @MaxLength(140)
	name?: string;

	@IsOptional() @IsString() @MaxLength(40)
	color?: string;

	@IsOptional() @IsString() @MaxLength(60)
	icon?: string;
}

/* =========================
 * Task DTOs
 * ========================= */
export class CreateTodoTaskDto {
	@IsString() @MaxLength(300)
	title!: string;

	@IsOptional() 
	folderId?: any | null;

	@IsOptional() @IsBoolean()
	completed?: boolean;

	@IsOptional() @IsEnum(TodoStatus)
	status?: TodoStatus;

	@IsOptional() @IsEnum(TodoPriority)
	priority?: TodoPriority;

	@IsOptional() @IsDateString()
	dueDate?: string | null; // YYYY-MM-DD

	@IsOptional() @IsString() @MaxLength(5)
	dueTime?: string | null; // HH:mm

	@IsOptional() @IsEnum(TodoRepeat)
	repeat?: TodoRepeat;

	@IsOptional() @IsInt() @Min(1)
	customRepeatDays?: number | null;

	@IsOptional() @IsArray() @IsString({ each: true })
	tags?: string[];

	@IsOptional() @IsBoolean()
	isStarred?: boolean;

	@IsOptional() @IsString()
	notes?: string | null;

	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => TodoAttachmentDto)
	attachments?: TodoAttachmentDto[];

	@IsOptional() @IsInt()
	orderIndex?: number;
}

export class UpdateTodoTaskDto {
	@IsOptional() @IsString() @MaxLength(300)
	title?: string;

	@IsOptional() @IsUUID()
	folderId?: string | null;

	@IsOptional() @IsBoolean()
	completed?: boolean;

	@IsOptional() @IsEnum(TodoStatus)
	status?: TodoStatus;

	@IsOptional() @IsEnum(TodoPriority)
	priority?: TodoPriority;

	@IsOptional() @IsDateString()
	dueDate?: string | null;

	@IsOptional() @IsString() @MaxLength(5)
	dueTime?: string | null;

	@IsOptional() @IsEnum(TodoRepeat)
	repeat?: TodoRepeat;

	@IsOptional() @IsInt() @Min(1)
	customRepeatDays?: number | null;

	@IsOptional() @IsArray() @IsString({ each: true })
	tags?: string[];

	@IsOptional() @IsBoolean()
	isStarred?: boolean;

	@IsOptional() @IsString()
	notes?: string | null;

	@IsOptional()
	@ValidateNested({ each: true })
	@Type(() => TodoAttachmentDto)
	attachments?: TodoAttachmentDto[];

	@IsOptional() @IsInt()
	orderIndex?: number;
}

/* =========================
 * Subtask DTOs
 * ========================= */
export class CreateTodoSubtaskDto {
	@IsString() @MaxLength(240)
	title!: string;

	@IsOptional() @IsBoolean()
	completed?: boolean;

	@IsOptional() @IsInt()
	orderIndex?: number;
}

export class UpdateTodoSubtaskDto {
	@IsOptional() @IsString() @MaxLength(240)
	title?: string;

	@IsOptional() @IsBoolean()
	completed?: boolean;

	@IsOptional() @IsInt()
	orderIndex?: number;
}

/* =========================
 * Reorder DTOs
 * ========================= */
export class ReorderItemDto {
	@IsUUID()
	id!: string;

	@IsInt()
	orderIndex!: number;
}

export class ReorderTasksDto {
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ReorderItemDto)
	items!: ReorderItemDto[];
}

export class ReorderSubtasksDto {
	@IsUUID()
	taskId!: string;

	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ReorderItemDto)
	items!: ReorderItemDto[];
}

/* =========================
 * Query DTO (optional)
 * ========================= */
export enum TodoView {
	INBOX = 'inbox',
	TODAY = 'today',
	STARRED = 'starred',
	FOLDER = 'folder',
}

export class ListTasksQueryDto {
	@IsOptional() @IsEnum(TodoView)
	view?: TodoView;

	@IsOptional() @IsUUID()
	folderId?: string;

	@IsOptional() @IsBoolean()
	includeCompleted?: boolean;

	@IsOptional() @IsEnum(TodoPriority)
	priority?: TodoPriority;

	@IsOptional() @IsString()
	sort?: 'manual' | 'dueDate' | 'priority' | 'alphabetical';
}
