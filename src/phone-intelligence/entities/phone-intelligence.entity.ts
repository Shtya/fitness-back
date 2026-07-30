import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum PhoneReportCategory {
	FRAUD = 'fraud',
	SPAM = 'spam',
	SALES = 'sales',
	DELIVERY = 'delivery',
	TRUSTED_BUSINESS = 'trusted_business',
	PERSONAL = 'personal',
	THREAT = 'threat',
	UNKNOWN = 'unknown',
}

export enum PublicMatchSourceType {
	BUSINESS = 'business',
	DIRECTORY = 'directory',
	AD = 'ad',
	NEWS = 'news',
	SOCIAL_PUBLIC = 'social_public',
	USER_COMMENT = 'user_comment',
	OTHER = 'other',
}

@Entity('phone_lookups')
export class PhoneLookup {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('idx_phone_lookups_phone_hash')
	@Column({ name: 'phone_hash', type: 'varchar', length: 64 })
	phoneHash: string;

	@Column({ name: 'e164_masked', type: 'varchar', length: 32, nullable: true })
	e164Masked: string | null;

	@Column({ type: 'boolean', default: false })
	valid: boolean;

	@Column({ type: 'varchar', length: 8, nullable: true })
	countryCode: string | null;

	@Column({ type: 'varchar', length: 64, nullable: true })
	country: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	carrier: string | null;

	@Column({ name: 'line_type', type: 'varchar', length: 64, nullable: true })
	lineType: string | null;

	@Column({ name: 'risk_score', type: 'float', nullable: true })
	riskScore: number | null;

	@Column({ name: 'risk_level', type: 'varchar', length: 32, nullable: true })
	riskLevel: string | null;

	@Column({ name: 'caller_name', type: 'varchar', length: 255, nullable: true })
	callerName: string | null;

	@Column({ name: 'caller_name_source', type: 'varchar', length: 64, nullable: true })
	callerNameSource: string | null;

	@Column({ name: 'provider_used', type: 'varchar', length: 64, nullable: true })
	providerUsed: string | null;

	@Column({ name: 'raw_provider', type: 'jsonb', nullable: true })
	rawProvider: Record<string, unknown> | null;

	@CreateDateColumn({ name: 'checked_at', type: 'timestamptz' })
	checkedAt: Date;
}

@Entity('phone_reports')
@Index('idx_phone_reports_hash_created', ['phoneHash', 'createdAt'])
export class PhoneReport {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('idx_phone_reports_phone_hash')
	@Column({ name: 'phone_hash', type: 'varchar', length: 64 })
	phoneHash: string;

	@Column({ name: 'country_code', type: 'varchar', length: 8, nullable: true })
	countryCode: string | null;

	@Column({
		type: 'varchar',
		length: 32,
		default: PhoneReportCategory.UNKNOWN,
	})
	category: PhoneReportCategory;

	@Column({ type: 'text', nullable: true })
	comment: string | null;

	@Index('idx_phone_reports_reporter')
	@Column({ name: 'reporter_user_id', type: 'uuid', nullable: true })
	reporterUserId: string | null;

	@Column({ name: 'ip_hash', type: 'varchar', length: 64, nullable: true })
	ipHash: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}

@Entity('public_matches')
@Index('uq_public_matches_hash_url', ['phoneHash', 'sourceUrl'], { unique: true })
export class PublicMatch {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('idx_public_matches_phone_hash')
	@Column({ name: 'phone_hash', type: 'varchar', length: 64 })
	phoneHash: string;

	@Column({ type: 'varchar', length: 512 })
	title: string;

	@Column({ type: 'text', nullable: true })
	snippet: string | null;

	@Column({ name: 'source_url', type: 'varchar', length: 1024 })
	sourceUrl: string;

	@Column({
		name: 'source_type',
		type: 'varchar',
		length: 32,
		default: PublicMatchSourceType.OTHER,
	})
	sourceType: PublicMatchSourceType;

	@Column({ name: 'possible_name', type: 'varchar', length: 255, nullable: true })
	possibleName: string | null;

	@Column({ name: 'confidence_score', type: 'float', default: 0.4 })
	confidenceScore: number;

	@Column({ name: 'is_official', type: 'boolean', default: false })
	isOfficial: boolean;

	@CreateDateColumn({ name: 'discovered_at', type: 'timestamptz' })
	discoveredAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

/** Encrypted API credentials for phone-intelligence providers (app-wide). */
@Entity('phone_intelligence_credentials')
export class PhoneIntelligenceCredential {
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

export enum PhoneEnrichmentStatus {
	QUEUED = 'queued',
	RUNNING = 'running',
	DONE = 'done',
	FAILED = 'failed',
}

export enum PhoneEnrichmentStepStatus {
	PENDING = 'pending',
	RUNNING = 'running',
	DONE = 'done',
	SKIPPED = 'skipped',
	FAILED = 'failed',
}

/** User-managed public search / directory sites used during deep phone checks. */
@Entity('phone_search_sites')
export class PhoneSearchSite {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 120 })
	name: string;

	/** Placeholders: {local} {e164} {e164Digits} {national} {country} {quotedLocal} */
	@Column({ name: 'url_template', type: 'varchar', length: 1024 })
	urlTemplate: string;

	/** Optional domain for site:domain Google queries, e.g. instagram.com */
	@Column({ type: 'varchar', length: 255, nullable: true })
	domain: string | null;

	/**
	 * engine = Google/Bing via APIs using site:domain
	 * url = open/fetch substituted URL if public
	 * manual = useful link only (login walls / ToS-sensitive)
	 */
	@Column({ type: 'varchar', length: 16, default: 'engine' })
	mode: 'engine' | 'url' | 'manual';

	@Column({ type: 'boolean', default: true })
	enabled: boolean;

	@Column({ name: 'needs_login', type: 'boolean', default: false })
	needsLogin: boolean;

	@Column({ type: 'text', nullable: true })
	notes: string | null;

	@Column({ name: 'sort_order', type: 'int', default: 100 })
	sortOrder: number;

	@Column({ name: 'is_builtin', type: 'boolean', default: false })
	isBuiltin: boolean;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('phone_enrichment_jobs')
@Index('idx_phone_enrichment_jobs_hash', ['phoneHash'])
@Index('idx_phone_enrichment_jobs_user', ['userId'])
export class PhoneEnrichmentJob {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index('idx_phone_enrichment_jobs_status')
	@Column({ type: 'varchar', length: 16, default: PhoneEnrichmentStatus.QUEUED })
	status: PhoneEnrichmentStatus;

	@Column({ name: 'phone_hash', type: 'varchar', length: 64 })
	phoneHash: string;

	@Column({ name: 'e164_masked', type: 'varchar', length: 32, nullable: true })
	e164Masked: string | null;

	@Column({ name: 'e164', type: 'varchar', length: 32 })
	e164: string;

	@Column({ name: 'country_code', type: 'varchar', length: 8, nullable: true })
	countryCode: string | null;

	@Column({ name: 'user_id', type: 'uuid', nullable: true })
	userId: string | null;

	@Column({ name: 'progress_percent', type: 'int', default: 0 })
	progressPercent: number;

	@Column({ name: 'current_step', type: 'varchar', length: 64, nullable: true })
	currentStep: string | null;

	@Column({ type: 'jsonb', default: [] })
	steps: Array<{
		id: string;
		labelEn: string;
		labelAr: string;
		status: PhoneEnrichmentStepStatus;
		message?: string | null;
		startedAt?: string | null;
		finishedAt?: string | null;
	}>;

	@Column({ name: 'partial_result', type: 'jsonb', nullable: true })
	partialResult: Record<string, unknown> | null;

	@Column({ name: 'final_result', type: 'jsonb', nullable: true })
	finalResult: Record<string, unknown> | null;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
	finishedAt: Date | null;
}
