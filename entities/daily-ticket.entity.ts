import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from './global.entity';

export const DAILY_TICKET_STATUSES = ['todo', 'doing', 'done'] as const;
export const DAILY_TICKET_PRIORITIES = ['high', 'medium', 'low'] as const;
export const DAILY_TICKET_MAX_TITLE = 120;
export const DAILY_TICKET_MAX_STEPS = 20;
export const DAILY_TICKET_MAX_NOTES = 5000;
export const DAILY_TICKET_MAX_ITEMS = 50;
export const DAILY_TICKET_MAX_ITEM_TEXT = 200;
export const DAILY_TICKET_REPEATS = ['none', 'daily'] as const;
/** Days of completion history kept for a repeating ticket. */
export const DAILY_TICKET_MAX_HISTORY = 120;

/** A checklist line inside a ticket. */
export type DailyTicketItem = { id: string; text: string; done: boolean };

/** How a repeating ticket ended one day (written when it resets for the next day). */
export type DailyTicketHistoryEntry = { day: string; done: boolean; progress: number; steps: number; doneAt: string | null };

export type DailyTicketStatus = (typeof DAILY_TICKET_STATUSES)[number];
export type DailyTicketPriority = (typeof DAILY_TICKET_PRIORITIES)[number];

/**
 * A personal daily task ticket (WhatsApp idle pane). A ticket can be split into `steps`;
 * `progress` counts the finished ones and the ticket is done when progress reaches steps.
 * `day` is the owner's local calendar day (YYYY-MM-DD) the ticket belongs to.
 */
@Entity('daily_tickets')
@Index(['userId', 'orderIndex'])
export class DailyTicket extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'int' })
	no!: number;

	@Column({ type: 'varchar', length: DAILY_TICKET_MAX_TITLE })
	title!: string;

	@Column({ type: 'varchar', length: 10, default: 'todo' })
	status!: DailyTicketStatus;

	@Column({ type: 'varchar', length: 10, default: 'medium' })
	priority!: DailyTicketPriority;

	@Column({ type: 'boolean', default: false })
	pinned!: boolean;

	@Column({ type: 'int', default: 1 })
	steps!: number;

	@Column({ type: 'int', default: 0 })
	progress!: number;

	@Column({ type: 'varchar', length: 10 })
	day!: string;

	@Column({ type: 'timestamptz', nullable: true })
	doneAt!: Date | null;

	@Column({ type: 'int', default: 0 })
	orderIndex!: number;

	@Column({ type: 'text', default: '' })
	notes!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	items!: DailyTicketItem[];

	/** 'daily': the ticket comes back as pending every new day. */
	@Column({ type: 'varchar', length: 10, default: 'none' })
	repeat!: (typeof DAILY_TICKET_REPEATS)[number];

	/** Earlier days of a repeating ticket, newest last. */
	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	history!: DailyTicketHistoryEntry[];
}
