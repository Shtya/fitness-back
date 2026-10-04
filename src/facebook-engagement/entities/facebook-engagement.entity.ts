import {
	Column,
	CreateDateColumn,
	DeleteDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum FbConnectionMethod {
	OAUTH = 'oauth',
	TOKEN = 'token',
}

export enum FbConnectionStatus {
	CONNECTED = 'connected',
	EXPIRED = 'expired',
	ERROR = 'error',
	DISCONNECTED = 'disconnected',
}

/** Only Pages today. The column exists so other official identity types can be added later. */
export enum FbAccountType {
	PAGE = 'page',
}

export enum FbAccountStatus {
	ACTIVE = 'active',
	REVOKED = 'revoked',
	ERROR = 'error',
}

export enum FbCampaignStatus {
	DRAFT = 'draft',
	QUEUED = 'queued',
	PROCESSING = 'processing',
	COMPLETED = 'completed',
	COMPLETED_WITH_ERRORS = 'completed_with_errors',
	FAILED = 'failed',
	CANCELLED = 'cancelled',
}

export enum FbCommentStatus {
	DRAFT = 'draft',
	PENDING = 'pending',
	PROCESSING = 'processing',
	PUBLISHED = 'published',
	FAILED = 'failed',
	CANCELLED = 'cancelled',
}

export enum FbJobStatus {
	QUEUED = 'queued',
	RUNNING = 'running',
	SUCCEEDED = 'succeeded',
	FAILED = 'failed',
	CANCELLED = 'cancelled',
}

export type FbActivityLevel = 'info' | 'success' | 'warning' | 'error';

@Entity('fb_engagement_connections')
export class FbEngagementConnection {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ type: 'varchar', length: 16 })
	method: FbConnectionMethod;

	@Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
	externalId: string | null;

	@Column({ name: 'display_name', type: 'varchar', length: 256, nullable: true })
	displayName: string | null;

	@Column({ name: 'encrypted_token', type: 'text', nullable: true, select: false })
	encryptedToken: string | null;

	@Column({ name: 'token_expires_at', type: 'timestamptz', nullable: true })
	tokenExpiresAt: Date | null;

	@Column({ type: 'text', array: true, default: () => "'{}'" })
	scopes: string[];

	@Column({ type: 'varchar', length: 16, default: FbConnectionStatus.CONNECTED })
	status: FbConnectionStatus;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
	lastSyncedAt: Date | null;
}

@Entity('fb_engagement_accounts')
@Index('idx_fb_eng_accounts_connection', ['connectionId'])
export class FbEngagementAccount {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ name: 'connection_id', type: 'uuid' })
	connectionId: string;

	@Column({ type: 'varchar', length: 16, default: FbAccountType.PAGE })
	type: FbAccountType;

	@Column({ name: 'external_id', type: 'varchar', length: 64 })
	externalId: string;

	@Column({ type: 'varchar', length: 256 })
	name: string;

	@Column({ type: 'varchar', length: 128, nullable: true })
	category: string | null;

	@Column({ name: 'picture_url', type: 'text', nullable: true })
	pictureUrl: string | null;

	@Column({ type: 'text', array: true, default: () => "'{}'" })
	tasks: string[];

	@Column({ name: 'can_publish_comments', type: 'boolean', default: false })
	canPublishComments: boolean;

	@Column({ name: 'encrypted_token', type: 'text', nullable: true, select: false })
	encryptedToken: string | null;

	@Column({ type: 'varchar', length: 16, default: FbAccountStatus.ACTIVE })
	status: FbAccountStatus;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
	lastSyncedAt: Date | null;
}

@Entity('fb_engagement_posts')
export class FbEngagementPost {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@Column({ name: 'external_id', type: 'varchar', length: 128 })
	externalId: string;

	@Column({ name: 'permalink_url', type: 'text', nullable: true })
	permalinkUrl: string | null;

	@Column({ type: 'text', nullable: true })
	message: string | null;

	@Column({ name: 'image_url', type: 'text', nullable: true })
	imageUrl: string | null;

	@Column({ name: 'author_name', type: 'varchar', length: 256, nullable: true })
	authorName: string | null;

	@Column({ name: 'published_at', type: 'timestamptz', nullable: true })
	publishedAt: Date | null;

	@Column({ name: 'reactions_count', type: 'int', default: 0 })
	reactionsCount: number;

	@Column({ name: 'comments_count', type: 'int', default: 0 })
	commentsCount: number;

	@Column({ name: 'shares_count', type: 'int', default: 0 })
	sharesCount: number;

	@Column({ name: 'fetched_at', type: 'timestamptz', default: () => 'now()' })
	fetchedAt: Date;
}

@Entity('fb_engagement_campaigns')
export class FbEngagementCampaign {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
	deletedAt: Date | null;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ type: 'varchar', length: 160 })
	name: string;

	@Column({ name: 'account_id', type: 'uuid', nullable: true })
	accountId: string | null;

	@Column({ name: 'post_id', type: 'uuid', nullable: true })
	postId: string | null;

	@Column({ type: 'varchar', length: 24, default: FbCampaignStatus.DRAFT })
	status: FbCampaignStatus;

	@Column({ name: 'pacing_seconds', type: 'int', default: 30 })
	pacingSeconds: number;

	@Column({ name: 'total_count', type: 'int', default: 0 })
	totalCount: number;

	@Column({ name: 'published_count', type: 'int', default: 0 })
	publishedCount: number;

	@Column({ name: 'failed_count', type: 'int', default: 0 })
	failedCount: number;

	@Column({ name: 'pending_count', type: 'int', default: 0 })
	pendingCount: number;

	@Column({ name: 'started_at', type: 'timestamptz', nullable: true })
	startedAt: Date | null;

	@Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
	finishedAt: Date | null;
}

@Entity('fb_engagement_comments')
@Index('idx_fb_eng_comments_campaign_position', ['campaignId', 'position'])
export class FbEngagementComment {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ name: 'campaign_id', type: 'uuid' })
	campaignId: string;

	@Column({ type: 'int', default: 0 })
	position: number;

	@Column({ type: 'text' })
	message: string;

	@Column({ name: 'account_id', type: 'uuid', nullable: true })
	accountId: string | null;

	@Column({ type: 'varchar', length: 16, default: FbCommentStatus.DRAFT })
	status: FbCommentStatus;

	@Column({ name: 'external_comment_id', type: 'varchar', length: 128, nullable: true })
	externalCommentId: string | null;

	@Column({ type: 'int', default: 0 })
	attempts: number;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'last_error_code', type: 'varchar', length: 64, nullable: true })
	lastErrorCode: string | null;

	@Column({ name: 'published_at', type: 'timestamptz', nullable: true })
	publishedAt: Date | null;
}

@Entity('fb_engagement_jobs')
export class FbEngagementJob {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ name: 'campaign_id', type: 'uuid' })
	campaignId: string;

	@Column({ name: 'comment_id', type: 'uuid' })
	commentId: string;

	@Column({ name: 'account_id', type: 'uuid', nullable: true })
	accountId: string | null;

	@Column({ type: 'varchar', length: 16, default: FbJobStatus.QUEUED })
	status: FbJobStatus;

	@Column({ name: 'run_after', type: 'timestamptz', default: () => 'now()' })
	runAfter: Date;

	@Column({ type: 'int', default: 0 })
	attempts: number;

	@Column({ name: 'max_attempts', type: 'int', default: 3 })
	maxAttempts: number;

	@Column({ name: 'locked_at', type: 'timestamptz', nullable: true })
	lockedAt: Date | null;

	@Column({ name: 'locked_by', type: 'varchar', length: 64, nullable: true })
	lockedBy: string | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'last_error_code', type: 'varchar', length: 64, nullable: true })
	lastErrorCode: string | null;

	@Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
	finishedAt: Date | null;
}

@Entity('fb_engagement_activity_logs')
export class FbEngagementActivityLog {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@Column({ name: 'owner_user_id', type: 'uuid' })
	ownerUserId: string;

	@Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
	actorUserId: string | null;

	@Column({ name: 'campaign_id', type: 'uuid', nullable: true })
	campaignId: string | null;

	@Column({ name: 'comment_id', type: 'uuid', nullable: true })
	commentId: string | null;

	@Column({ type: 'varchar', length: 64 })
	action: string;

	@Column({ type: 'varchar', length: 16, default: 'info' })
	level: FbActivityLevel;

	@Column({ type: 'text' })
	message: string;

	@Column({ type: 'jsonb', nullable: true })
	details: Record<string, unknown> | null;
}

export const FB_ENGAGEMENT_ENTITIES = [
	FbEngagementConnection,
	FbEngagementAccount,
	FbEngagementPost,
	FbEngagementCampaign,
	FbEngagementComment,
	FbEngagementJob,
	FbEngagementActivityLog,
];
