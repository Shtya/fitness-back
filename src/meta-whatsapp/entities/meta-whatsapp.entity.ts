import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum MetaWaConnectionStatus {
	DISCONNECTED = 'disconnected',
	CONNECTED = 'connected',
	ERROR = 'error',
	DISABLED = 'disabled',
}

export enum MetaWaMessageDirection {
	INBOUND = 'inbound',
	OUTBOUND = 'outbound',
}

export enum MetaWaMessageStatus {
	PENDING = 'pending',
	QUEUED = 'queued',
	SENT = 'sent',
	DELIVERED = 'delivered',
	READ = 'read',
	FAILED = 'failed',
	RECEIVED = 'received',
}

export enum MetaWaBulkJobStatus {
	QUEUED = 'queued',
	RUNNING = 'running',
	PAUSED = 'paused',
	DONE = 'done',
	FAILED = 'failed',
	CANCELLED = 'cancelled',
}

export enum MetaWaBulkItemStatus {
	QUEUED = 'queued',
	SENDING = 'sending',
	SENT = 'sent',
	FAILED = 'failed',
	SKIPPED = 'skipped',
}

@Entity('meta_whatsapp_config')
export class MetaWhatsAppConfig {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'boolean', default: false })
	enabled: boolean;

	@Column({ name: 'phone_number_id', type: 'varchar', length: 64, nullable: true })
	phoneNumberId: string | null;

	@Column({ name: 'waba_id', type: 'varchar', length: 64, nullable: true })
	wabaId: string | null;

	@Column({ name: 'display_phone_number', type: 'varchar', length: 32, nullable: true })
	displayPhoneNumber: string | null;

	@Column({ name: 'verify_token_hash', type: 'varchar', length: 128, nullable: true })
	verifyTokenHash: string | null;

	@Column({ name: 'encrypted_credentials', type: 'text', nullable: true })
	encryptedCredentials: string | null;

	@Column({
		name: 'connection_status',
		type: 'varchar',
		length: 32,
		default: MetaWaConnectionStatus.DISCONNECTED,
	})
	connectionStatus: MetaWaConnectionStatus;

	@Column({ name: 'last_validated_at', type: 'timestamptz', nullable: true })
	lastValidatedAt: Date | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({
		name: 'webhook_path',
		type: 'varchar',
		length: 256,
		default: '/api/v1/meta-whatsapp/webhook',
	})
	webhookPath: string;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('meta_whatsapp_conversations')
@Index('idx_meta_wa_conversations_lead', ['leadId'])
export class MetaWhatsAppConversation {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'lead_id', type: 'uuid', nullable: true })
	leadId: string | null;

	@Index('uq_meta_wa_conversations_wa_id', { unique: true })
	@Column({ name: 'wa_id', type: 'varchar', length: 32 })
	waId: string;

	@Column({ name: 'display_name', type: 'varchar', length: 256, nullable: true })
	displayName: string | null;

	@Column({ name: 'business_name', type: 'varchar', length: 512, nullable: true })
	businessName: string | null;

	@Column({ name: 'last_message_preview', type: 'text', nullable: true })
	lastMessagePreview: string | null;

	@Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
	lastMessageAt: Date | null;

	@Column({ name: 'last_inbound_at', type: 'timestamptz', nullable: true })
	lastInboundAt: Date | null;

	@Column({ name: 'unread_count', type: 'int', default: 0 })
	unreadCount: number;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('meta_whatsapp_messages')
@Index('idx_meta_wa_messages_conversation', ['conversationId', 'createdAt'])
@Index('idx_meta_wa_messages_lead', ['leadId'])
export class MetaWhatsAppMessage {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@Column({ type: 'varchar', length: 16 })
	direction: MetaWaMessageDirection;

	@Column({ name: 'message_type', type: 'varchar', length: 32, default: 'text' })
	messageType: string;

	@Column({ type: 'text', nullable: true })
	body: string | null;

	@Column({ name: 'template_name', type: 'varchar', length: 128, nullable: true })
	templateName: string | null;

	@Column({ name: 'template_language', type: 'varchar', length: 16, nullable: true })
	templateLanguage: string | null;

	@Column({ name: 'template_components', type: 'jsonb', nullable: true })
	templateComponents: any | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	wamid: string | null;

	@Column({ type: 'varchar', length: 32, default: MetaWaMessageStatus.PENDING })
	status: MetaWaMessageStatus;

	@Column({ name: 'error_code', type: 'varchar', length: 64, nullable: true })
	errorCode: string | null;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@Column({ name: 'media_id', type: 'varchar', length: 128, nullable: true })
	mediaId: string | null;

	@Column({ name: 'media_mime_type', type: 'varchar', length: 128, nullable: true })
	mediaMimeType: string | null;

	@Column({ name: 'media_file_name', type: 'varchar', length: 256, nullable: true })
	mediaFileName: string | null;

	@Column({ name: 'media_url', type: 'text', nullable: true })
	mediaUrl: string | null;

	@Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
	rawPayload: any | null;

	@Column({ name: 'pricing_category', type: 'varchar', length: 32, nullable: true })
	pricingCategory: string | null;

	@Column({ name: 'pricing_type', type: 'varchar', length: 32, nullable: true })
	pricingType: string | null;

	@Column({ name: 'pricing_model', type: 'varchar', length: 64, nullable: true })
	pricingModel: string | null;

	@Column({ type: 'boolean', nullable: true })
	billable: boolean | null;

	@Column({ name: 'recipient_country', type: 'varchar', length: 8, nullable: true })
	recipientCountry: string | null;

	@Column({
		name: 'estimated_cost_usd',
		type: 'numeric',
		precision: 12,
		scale: 6,
		nullable: true,
		transformer: {
			to: (v: number | null) => v,
			from: (v: string | number | null) => (v == null ? null : Number(v)),
		},
	})
	estimatedCostUsd: number | null;

	@Column({ name: 'sent_by', type: 'uuid', nullable: true })
	sentBy: string | null;

	@Column({ name: 'lead_id', type: 'uuid', nullable: true })
	leadId: string | null;

	@Column({ name: 'provider_timestamp', type: 'timestamptz', nullable: true })
	providerTimestamp: Date | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('meta_whatsapp_bulk_jobs')
@Index('idx_meta_wa_bulk_jobs_status', ['status'])
export class MetaWhatsAppBulkJob {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 16, default: MetaWaBulkJobStatus.QUEUED })
	status: MetaWaBulkJobStatus;

	@Column({ name: 'created_by', type: 'uuid', nullable: true })
	createdBy: string | null;

	@Column({ name: 'template_name', type: 'varchar', length: 128 })
	templateName: string;

	@Column({ name: 'template_language', type: 'varchar', length: 16, default: 'en' })
	templateLanguage: string;

	@Column({ name: 'template_components', type: 'jsonb', nullable: true })
	templateComponents: any | null;

	@Column({ name: 'total_count', type: 'int', default: 0 })
	totalCount: number;

	@Column({ name: 'sent_count', type: 'int', default: 0 })
	sentCount: number;

	@Column({ name: 'failed_count', type: 'int', default: 0 })
	failedCount: number;

	@Column({ name: 'skipped_count', type: 'int', default: 0 })
	skippedCount: number;

	@Column({ name: 'rate_limit_per_minute', type: 'int', default: 20 })
	rateLimitPerMinute: number;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@Column({ name: 'started_at', type: 'timestamptz', nullable: true })
	startedAt: Date | null;

	@Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
	finishedAt: Date | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('meta_whatsapp_bulk_items')
@Index('idx_meta_wa_bulk_items_job', ['jobId', 'status'])
export class MetaWhatsAppBulkItem {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'job_id', type: 'uuid' })
	jobId: string;

	@Column({ name: 'lead_id', type: 'uuid', nullable: true })
	leadId: string | null;

	@Column({ name: 'wa_id', type: 'varchar', length: 32 })
	waId: string;

	@Column({ name: 'display_name', type: 'varchar', length: 256, nullable: true })
	displayName: string | null;

	@Column({ type: 'varchar', length: 16, default: MetaWaBulkItemStatus.QUEUED })
	status: MetaWaBulkItemStatus;

	@Column({ name: 'message_id', type: 'uuid', nullable: true })
	messageId: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	wamid: string | null;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@Column({ name: 'attempt_count', type: 'int', default: 0 })
	attemptCount: number;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('meta_whatsapp_activity_logs')
export class MetaWhatsAppActivityLog {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 64 })
	action: string;

	@Column({ name: 'actor_id', type: 'uuid', nullable: true })
	actorId: string | null;

	@Column({ type: 'jsonb', nullable: true })
	details: any | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}

@Entity('meta_whatsapp_quick_replies')
@Index('idx_meta_wa_quick_replies_sort', ['sortOrder'])
export class MetaWhatsAppQuickReply {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ type: 'varchar', length: 120 })
	title: string;

	@Column({ type: 'text' })
	body: string;

	@Column({ name: 'sort_order', type: 'int', default: 0 })
	sortOrder: number;

	@Column({ name: 'is_default', type: 'boolean', default: false })
	isDefault: boolean;

	@Column({ name: 'created_by', type: 'uuid', nullable: true })
	createdBy: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}
