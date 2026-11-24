import { Column, Entity, Index, Unique } from 'typeorm';
import { CoreEntity } from './global.entity';

/**
 * The "Habits" tab of Today's tickets (WhatsApp page): one row per user with every habit
 * (schedule, daily log, subtasks…), the motivation cards and the start of the 14-day plan.
 * Edits are merged by id (newest `updatedAt` wins), so a phone and a laptop never overwrite
 * each other's other habits.
 */
@Entity('habit_trackers')
@Unique('uq_habit_tracker_user', ['userId'])
@Index(['userId'])
export class HabitTracker extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	habits!: Record<string, any>[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	cards!: Record<string, any>[];

	/** First day of the plan (YYYY-MM-DD); the grid shows 14-day blocks from here. */
	@Column({ type: 'varchar', length: 10, default: '' })
	planStart!: string;
}
