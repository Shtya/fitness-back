// src/modules/calendar/calendar.entity.ts
import {
	Entity,
	Column,
	Index,
	ManyToOne,
	JoinColumn,
	Unique,
} from 'typeorm';
import { CoreEntity, User } from './global.entity';

// ==============================
// Enums
// ==============================
export enum CalendarRecurrence {
	NONE = 'none',
	DAILY = 'daily',
	WEEKLY = 'weekly',
	MONTHLY = 'monthly',
	CUSTOM = 'custom',
	EVERY_X_DAYS = 'every_x_days',
}


@Entity('calendar_event_types')
@Index(['adminId'])
@Unique('uq_calendar_type_admin_name', ['adminId', 'name'])
export class CalendarEventType extends CoreEntity {
	@Column({ type: 'varchar', length: 120 })
	name!: string;

	// Tailwind string from your UI (example: "bg-gradient-to-br from-indigo-300 to-violet-200")
	@Column({ type: 'varchar', length: 255 })
	color!: string;

	@Column({ type: 'varchar', length: 80, default: 'text-gray-700' })
	textColor!: string;

	@Column({ type: 'varchar', length: 80, default: 'border-gray-200' })
	border!: string;

	@Column({ type: 'varchar', length: 80, default: 'ring-gray-500' })
	ring!: string;

	// ex: "Target", "Bell", ...
	@Column({ type: 'varchar', length: 80, default: 'Target' })
	icon!: string;

	@Column({ type: 'boolean', default: true })
	isActive!: boolean;

	// tenant
	@Column({ type: 'uuid', nullable: true })

	adminId!: string | null;
}

@Entity('calendar_items')
@Index(['adminId'])
@Index(['userId'])
export class CalendarItem extends CoreEntity {
	@Column({ type: 'varchar', length: 220 })
	title!: string;

	// ✅ built-in types: "habit" | "task" | ...
	@Column({ type: 'varchar', length: 50, nullable: true })
	typeKey!: string | null;

	@Column({ type: 'varchar', nullable: true })
	typeId!: string | null;

	@ManyToOne(() => CalendarEventType, { nullable: true, onDelete: 'SET NULL', eager: true })
	@JoinColumn({ name: 'typeId' })
	type?: CalendarEventType | null;

	@Column({ type: 'date' })
	startDate!: string;

	@Column({ type: 'varchar', length: 10, nullable: true })
	startTime?: string | null;

	@Column({ type: 'varchar', length: 20, default: CalendarRecurrence.NONE })
	recurrence!: CalendarRecurrence;

	@Column({ type: 'int', default: 1 })
	recurrenceInterval!: number;

	@Column('int', { array: true, default: '{}' })
	recurrenceDays!: number[];

	@Column({ type: 'uuid' })
	userId!: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Column({ type: 'uuid', nullable: true })
	adminId!: string | null;
}

@Entity('calendar_completions')
@Index(['adminId'])
@Index(['userId'])
@Unique('uq_calendar_completion_item_date_user', ['itemId', 'date', 'userId'])
export class CalendarCompletion extends CoreEntity {
	@Column({ type: 'uuid' })
	itemId!: string;

	@ManyToOne(() => CalendarItem, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'itemId' })
	item!: CalendarItem;

	@Column({ type: 'date' })
	date!: string; // YYYY-MM-DD

	@Column({ type: 'boolean', default: true })
	completed!: boolean;


	@Column({ type: 'uuid' })
	userId!: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Column({ type: 'uuid', nullable: true })

	adminId!: string | null;
}

@Entity('calendar_settings')
@Index(['adminId'])
@Unique('uq_calendar_settings_user', ['userId'])
export class CalendarSettings extends CoreEntity {
	@Column({ type: 'boolean', default: false })
	showWeekNumbers!: boolean;

	@Column({ type: 'boolean', default: true })
	highlightWeekend!: boolean;

	// JS days: 0..6
	@Column('int', { array: true, default: '{5,6}' })
	weekendDays!: number[];

	// 0 Sunday, 1 Monday, 6 Saturday
	@Column({ type: 'int', default: 6 })
	startOfWeek!: number;

	@Column({ type: 'boolean', default: true })
	confirmBeforeDelete!: boolean;


	@Column({ type: 'uuid' })
	userId!: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	@Column({ type: 'uuid', nullable: true })

	adminId!: string | null;
}

@Entity('commitment_timers')
@Index(['adminId'])
@Unique('uq_commitment_timer_user', ['userId'])
export class CommitmentTimer extends CoreEntity {

	@Column({ type: 'uuid' })
	userId!: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId' })
	user!: User;

	// timestamp in ms (like your frontend localStorage)
	@Column({ type: 'bigint', nullable: true })
	startTimeMs!: string | null;

	@Column({ type: 'boolean', default: false })
	isRunning!: boolean;

	@Column({ type: 'uuid', nullable: true })

	adminId!: string | null;
}
