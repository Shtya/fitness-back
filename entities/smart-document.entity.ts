import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from './global.entity';

@Entity('smart_shared_documents')
@Index(['ownerUserId'])
@Index(['localDocId', 'ownerUserId'])
export class SmartSharedDocument extends CoreEntity {
	@Column({ type: 'varchar', length: 40, unique: true })
	token!: string;

	/** Client-side history id from the document editor */
	@Column({ type: 'varchar', length: 80, name: 'local_doc_id', nullable: true })
	localDocId!: string | null;

	@Column({ type: 'uuid', name: 'owner_user_id', nullable: true })
	ownerUserId!: string | null;

	@Column({ type: 'varchar', length: 200, default: 'Untitled' })
	title!: string;

	@Column({ type: 'text', default: '' })
	content!: string;

	@Column({ type: 'jsonb', nullable: true })
	typography!: Record<string, unknown> | null;

	/** Open events: time, IP/geo, browser metadata */
	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	visits!: Array<Record<string, unknown>>;
}
