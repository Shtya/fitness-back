import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import {
	DAILY_TICKET_MAX_ITEM_TEXT,
	DAILY_TICKET_MAX_ITEMS,
	DAILY_TICKET_MAX_NOTES,
	DAILY_TICKET_MAX_STEPS,
	DAILY_TICKET_MAX_TITLE,
	DAILY_TICKET_PRIORITIES,
	DAILY_TICKET_STATUSES,
} from 'entities/daily-ticket.entity';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class ListDailyTicketsQuery {
	@IsOptional()
	@Matches(DAY)
	today?: string;

	/** The frontend's axios adds ?lang= to every request. */
	@IsOptional()
	@IsString()
	lang?: string;
}

export class DailyTicketItemDto {
	@IsString()
	@MinLength(1)
	@MaxLength(40)
	id!: string;

	@IsString()
	@MaxLength(DAILY_TICKET_MAX_ITEM_TEXT)
	text!: string;

	@IsBoolean()
	done!: boolean;
}

class DailyTicketFields {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(DAILY_TICKET_MAX_TITLE)
	title?: string;

	@IsOptional()
	@IsIn(DAILY_TICKET_STATUSES as unknown as string[])
	status?: (typeof DAILY_TICKET_STATUSES)[number];

	@IsOptional()
	@IsIn(DAILY_TICKET_PRIORITIES as unknown as string[])
	priority?: (typeof DAILY_TICKET_PRIORITIES)[number];

	@IsOptional()
	@IsBoolean()
	pinned?: boolean;

	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(DAILY_TICKET_MAX_STEPS)
	steps?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(DAILY_TICKET_MAX_STEPS)
	progress?: number;

	@IsOptional()
	@Matches(DAY)
	day?: string;

	/** Epoch milliseconds, or null to clear. */
	@IsOptional()
	@IsNumber()
	doneAt?: number | null;

	@IsOptional()
	@IsString()
	@MaxLength(DAILY_TICKET_MAX_NOTES)
	notes?: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(DAILY_TICKET_MAX_ITEMS)
	@ValidateNested({ each: true })
	@Type(() => DailyTicketItemDto)
	items?: DailyTicketItemDto[];
}

export class UpdateDailyTicketDto extends DailyTicketFields {}

export class CreateDailyTicketDto extends DailyTicketFields {
	/** Client-generated id, so the ticket keeps the same id before and after saving. */
	@IsOptional()
	@IsUUID()
	id?: string;

	/** Only used when putting a deleted ticket back (undo) or importing. */
	@IsOptional()
	@IsInt()
	@Min(1)
	no?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	index?: number;

	@IsOptional()
	@IsNumber()
	createdAt?: number;
}

export class ReorderDailyTicketsDto {
	@IsArray()
	@ArrayMaxSize(500)
	@IsUUID('all', { each: true })
	ids!: string[];
}

export class ImportDailyTicketsDto {
	@IsArray()
	@ArrayMaxSize(200)
	@ValidateNested({ each: true })
	@Type(() => CreateDailyTicketDto)
	items!: CreateDailyTicketDto[];
}
