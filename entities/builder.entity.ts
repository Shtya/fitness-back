import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('builder_projects')
export class BuilderProject {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ unique: true })
	tenant: string;

	@Column({ type: 'jsonb', nullable: true })
	draftDoc: any;

	@Column({ type: 'jsonb', nullable: true })
	publishedDoc: any;

	@Column({ type: 'jsonb', nullable: true })
	settings: {
		domain?: string;
		metaTitle?: string;
		metaDescription?: string;
	};

	@CreateDateColumn({ type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ type: 'timestamptz' })
	updatedAt: Date;
}
