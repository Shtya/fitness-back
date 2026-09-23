import { Column, Entity, Index, Unique } from 'typeorm';
import { CoreEntity } from './global.entity';

/**
 * Per-user AI Reading Studio cloud state (books, prompts, topics, …).
 * JSONB documents so the reading product can evolve without frequent migrations.
 */
@Entity('ai_reading_states')
@Unique('uq_ai_reading_user', ['userId'])
@Index(['userId'])
export class AiReadingState extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	books!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	prompts!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	topics!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	journeys!: any[];

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	prefs!: Record<string, any>;

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	stats!: Record<string, any>;

	@Column({ type: 'jsonb', nullable: true })
	chat!: Record<string, any> | null;
}
