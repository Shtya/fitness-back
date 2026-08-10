import { Column, Entity, Index, Unique } from 'typeorm';
import { CoreEntity } from './global.entity';

/**
 * Per-user Personal Learning OS cloud state.
 * Paths, topics, resources, review queue, and activity live as JSON documents
 * so the product can evolve without frequent schema migrations.
 */
@Entity('learning_states')
@Unique('uq_learning_user', ['userId'])
@Index(['userId'])
export class LearningState extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	paths!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	inbox!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	activity!: any[];

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	stats!: Record<string, any>;

	@Column({ type: 'jsonb', nullable: true })
	continueLearning!: Record<string, any> | null;
}
