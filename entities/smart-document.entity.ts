import { Column, Entity, Index } from 'typeorm';
import { CoreEntity } from './global.entity';

/**
 * A user's own document from the Documents editor (WhatsApp "Documents" tab and the super-admin
 * Document Editor). The editor's local history is only a cache; this is the copy that survives a
 * cleared browser. `clientId` is the editor's id (`d_…`) so local and server copies line up.
 */
@Entity('smart_documents')
@Index(['ownerUserId', 'clientId'], { unique: true })
@Index(['ownerUserId', 'clientUpdatedAt'])
export class SmartDocument extends CoreEntity {
	@Column({ type: 'uuid', name: 'owner_user_id' })
	ownerUserId!: string;

	@Column({ type: 'varchar', length: 80, name: 'client_id' })
	clientId!: string;

	@Column({ type: 'varchar', length: 200, default: 'Untitled' })
	title!: string;

	@Column({ type: 'boolean', name: 'title_locked', default: false })
	titleLocked!: boolean;

	@Column({ type: 'text', default: '' })
	content!: string;

	/** When the writer last changed it (the editor's clock), used to keep the newer copy. */
	@Column({ type: 'timestamptz', name: 'client_updated_at' })
	clientUpdatedAt!: Date;
}

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
