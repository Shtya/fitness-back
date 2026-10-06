import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const PAGE_MODES = ['default', 'optional', 'locked'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

export const MANAGED_PAGE_ROLES = ['super_admin', 'admin', 'coach', 'client'] as const;
export type ManagedPageRole = (typeof MANAGED_PAGE_ROLES)[number];

@Entity('role_page_settings')
export class RolePageSetting {
	@PrimaryColumn({ type: 'varchar', length: 32 })
	role: ManagedPageRole;

	@PrimaryColumn({ name: 'page_id', type: 'varchar', length: 64 })
	pageId: string;

	@Column({ type: 'varchar', length: 16 })
	mode: PageMode;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;
}

@Entity('user_page_overrides')
export class UserPageOverride {
	@PrimaryColumn({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'extra_pages', type: 'text', array: true, default: () => "'{}'" })
	extraPages: string[];

	@Column({ name: 'locked_pages', type: 'text', array: true, default: () => "'{}'" })
	lockedPages: string[];

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;
}
