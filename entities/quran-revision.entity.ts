import { Column, Entity, Index, Unique } from 'typeorm';
import { CoreEntity } from './global.entity';

/**
 * Per-user Quran revision cloud state (favorites, folders, history, marks, active session).
 * UI prefs (surah/units/toggles) stay on the client in localStorage.
 */
@Entity('quran_revision_states')
@Unique('uq_quran_revision_user', ['userId'])
@Index(['userId'])
export class QuranRevisionState extends CoreEntity {
	@Column({ type: 'uuid' })
	userId!: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	folders!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	favorites!: any[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	history!: any[];

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	wordErrors!: Record<string, string>;

	@Column({ type: 'jsonb', nullable: true })
	activeSession!: Record<string, any> | null;
}
