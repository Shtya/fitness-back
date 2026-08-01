import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

@Entity('fitness_leads_credentials')
export class FitnessLeadsCredential {
	@PrimaryColumn({ type: 'varchar', length: 32 })
	provider: string;

	@Column({ name: 'encrypted_payload', type: 'text' })
	encryptedPayload: string;

	@Column({ name: 'key_last_four', type: 'varchar', length: 8, nullable: true })
	keyLastFour: string | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

export enum FitnessLeadsJobStatus {
	QUEUED = 'queued',
	RUNNING = 'running',
	DONE = 'done',
	FAILED = 'failed',
}

@Entity('fitness_leads_jobs')
@Index('idx_fitness_leads_jobs_user', ['userId'])
export class FitnessLeadsJob {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('idx_fitness_leads_jobs_status')
	@Column({ type: 'varchar', length: 16, default: FitnessLeadsJobStatus.QUEUED })
	status: FitnessLeadsJobStatus;

	@Column({ name: 'user_id', type: 'uuid', nullable: true })
	userId: string | null;

	@Column({ name: 'country_key', type: 'varchar', length: 8 })
	countryKey: string;

	@Column({ type: 'jsonb', default: [] })
	cities: string[];

	@Column({ type: 'jsonb', default: [] })
	categories: string[];

	@Column({ name: 'enrich_websites', type: 'boolean', default: true })
	enrichWebsites: boolean;

	@Column({ name: 'use_osm', type: 'boolean', default: true })
	useOsm: boolean;

	@Column({ name: 'max_places', type: 'int', default: 40 })
	maxPlaces: number;

	@Column({ name: 'progress_percent', type: 'int', default: 0 })
	progressPercent: number;

	@Column({ name: 'current_step', type: 'varchar', length: 64, nullable: true })
	currentStep: string | null;

	@Column({ type: 'jsonb', default: [] })
	steps: any[];

	@Column({ name: 'leads_count', type: 'int', default: 0 })
	leadsCount: number;

	@Column({ name: 'is_favorite', type: 'boolean', default: false })
	isFavorite: boolean;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
	finishedAt: Date | null;
}

@Entity('fitness_leads')
@Index('idx_fitness_leads_job', ['jobId'])
@Index('idx_fitness_leads_phone', ['phone'])
export class FitnessLead {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'job_id', type: 'uuid' })
	jobId: string;

	@Column({ name: 'user_id', type: 'uuid', nullable: true })
	userId: string | null;

	@Column({ name: 'business_name', type: 'varchar', length: 512 })
	businessName: string;

	@Column({ name: 'business_type', type: 'varchar', length: 128, nullable: true })
	businessType: string | null;

	@Column({ type: 'varchar', length: 320, nullable: true })
	email: string | null;

	@Column({ type: 'varchar', length: 64, nullable: true })
	country: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	city: string | null;

	@Column({ type: 'varchar', length: 256, nullable: true })
	neighborhood: string | null;

	@Column({ type: 'varchar', length: 1024, nullable: true })
	address: string | null;

	@Column({ type: 'varchar', length: 1024, nullable: true })
	website: string | null;

	@Column({ name: 'source_url', type: 'varchar', length: 1024, nullable: true })
	sourceUrl: string | null;

	@Column({ name: 'linkedin_url', type: 'varchar', length: 512, nullable: true })
	linkedinUrl: string | null;

	@Column({ name: 'instagram_url', type: 'varchar', length: 512, nullable: true })
	instagramUrl: string | null;

	@Column({ name: 'facebook_url', type: 'varchar', length: 512, nullable: true })
	facebookUrl: string | null;

	@Column({ name: 'twitter_url', type: 'varchar', length: 512, nullable: true })
	twitterUrl: string | null;

	@Column({ name: 'tiktok_url', type: 'varchar', length: 512, nullable: true })
	tiktokUrl: string | null;

	@Column({ name: 'youtube_url', type: 'varchar', length: 512, nullable: true })
	youtubeUrl: string | null;

	@Column({ name: 'whatsapp_url', type: 'varchar', length: 512, nullable: true })
	whatsappUrl: string | null;

	@Column({ name: 'email_type', type: 'varchar', length: 64, nullable: true })
	emailType: string | null;

	@Column({ name: 'verification_status', type: 'varchar', length: 64, nullable: true })
	verificationStatus: string | null;

	@Column({ type: 'text', nullable: true })
	notes: string | null;

	@Column({ type: 'varchar', length: 64, nullable: true })
	phone: string | null;

	@Column({ name: 'found_via', type: 'varchar', length: 64, nullable: true })
	foundVia: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}
