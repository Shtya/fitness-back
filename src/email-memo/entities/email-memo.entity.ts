import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	OneToOne,
	PrimaryGeneratedColumn,
	UpdateDateColumn,
} from 'typeorm';

export enum EmailMemoMessageStatus {
	RECEIVED = 'RECEIVED',
	PROCESSING = 'PROCESSING',
	AI_COMPLETED = 'AI_COMPLETED',
	SENDING = 'SENDING',
	SENT = 'SENT',
	FAILED = 'FAILED',
	SKIPPED = 'SKIPPED',
}

export enum EmailMemoWhatsAppStatus {
	DISCONNECTED = 'disconnected',
	CONNECTING = 'connecting',
	QR_PENDING = 'qr_pending',
	CONNECTED = 'connected',
	ERROR = 'error',
}

export enum EmailMemoDeliveryStatus {
	QUEUED = 'queued',
	SENT = 'sent',
	FAILED = 'failed',
}

@Entity('email_memo_gmail_connections')
@Index('idx_email_memo_gmail_user', ['userId'])
@Index('uq_email_memo_gmail_user_address', ['userId', 'gmailAddress'], {
	unique: true,
	where: '"gmail_address" IS NOT NULL',
})
export class EmailMemoGmailConnection {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'gmail_address', type: 'varchar', length: 320, nullable: true })
	gmailAddress: string | null;

	@Column({ name: 'encrypted_tokens', type: 'text', nullable: true })
	encryptedTokens: string | null;

	@Column({ name: 'encrypted_oauth_app', type: 'text', nullable: true })
	encryptedOauthApp: string | null;

	@Column({ name: 'history_id', type: 'varchar', length: 64, nullable: true })
	historyId: string | null;

	@Column({ name: 'watch_expiration', type: 'timestamptz', nullable: true })
	watchExpiration: Date | null;

	@Column({ name: 'connected_at', type: 'timestamptz', default: () => 'now()' })
	connectedAt: Date;

	@Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
	lastSyncedAt: Date | null;

	@Column({ type: 'varchar', length: 32, default: 'disconnected' })
	status: string;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'oauth_verified_at', type: 'timestamptz', nullable: true })
	oauthVerifiedAt: Date | null;

	@OneToMany(() => EmailMemoGmailMessage, (row) => row.connection)
	messages?: EmailMemoGmailMessage[];

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('email_memo_gmail_messages')
@Index('uq_email_memo_gmail_message', ['gmailConnectionId', 'gmailMessageId'], { unique: true })
export class EmailMemoGmailMessage {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'gmail_connection_id', type: 'uuid' })
	gmailConnectionId: string;

	@ManyToOne(() => EmailMemoGmailConnection, (row) => row.messages, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'gmail_connection_id' })
	connection: any;

	@Column({ name: 'gmail_message_id', type: 'varchar', length: 128 })
	gmailMessageId: string;

	@Column({ name: 'thread_id', type: 'varchar', length: 128, nullable: true })
	threadId: string | null;

	@Column({ name: 'sender_name', type: 'varchar', length: 320, nullable: true })
	senderName: string | null;

	@Column({ name: 'sender_email', type: 'varchar', length: 320, nullable: true })
	senderEmail: string | null;

	@Column({ type: 'text', nullable: true })
	subject: string | null;

	@Column({ type: 'text', nullable: true })
	snippet: string | null;

	@Column({ name: 'body_text', type: 'text', nullable: true })
	bodyText: string | null;

	@Column({ name: 'gmail_url', type: 'text', nullable: true })
	gmailUrl: string | null;

	@Column({ name: 'label_ids', type: 'jsonb', nullable: true })
	labelIds: string[] | null;

	@Column({ name: 'received_at', type: 'timestamptz', nullable: true })
	receivedAt: Date | null;

	@Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
	processedAt: Date | null;

	@Column({ type: 'varchar', length: 32, default: EmailMemoMessageStatus.RECEIVED })
	status: EmailMemoMessageStatus;

	@Column({ name: 'skip_reason', type: 'varchar', length: 64, nullable: true })
	skipReason: string | null;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@Column({ name: 'attempt_count', type: 'int', default: 0 })
	attemptCount: number;

	@Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
	nextRetryAt: Date | null;

	@Column({ name: 'send_after', type: 'timestamptz', nullable: true })
	sendAfter: Date | null;

	@OneToOne(() => EmailMemoAiMemo, (row) => row.gmailMessage)
	aiMemo: any;

	@OneToMany(() => EmailMemoWhatsAppMessage, (row) => row.gmailMessage)
	whatsappMessages: any[];

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('email_memo_ai_memos')
export class EmailMemoAiMemo {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'gmail_message_id', type: 'uuid' })
	gmailMessageId: string;

	@OneToOne(() => EmailMemoGmailMessage, (row) => row.aiMemo, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'gmail_message_id' })
	gmailMessage: any;

	@Column({ type: 'varchar', length: 32, default: 'gemini' })
	provider: string;

	@Column({ type: 'varchar', length: 80, nullable: true })
	model: string | null;

	@Column({ name: 'memo_text', type: 'text' })
	memoText: string;

	@Column({ name: 'action_text', type: 'text', nullable: true })
	actionText: string | null;

	@Column({ type: 'varchar', length: 16, nullable: true })
	priority: string | null;

	@Column({ type: 'text', nullable: true })
	deadline: string | null;

	@Column({ name: 'formatted_message', type: 'text' })
	formattedMessage: string;

	@Column({ name: 'prompt_version', type: 'varchar', length: 32, nullable: true })
	promptVersion: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}

@Entity('email_memo_whatsapp_connections')
@Index('uq_email_memo_wa_user', ['userId'], { unique: true })
export class EmailMemoWhatsAppConnection {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'whatsapp_account_id', type: 'uuid', nullable: true })
	whatsappAccountId: string | null;

	@Column({ name: 'dedicated_account', type: 'boolean', default: true })
	dedicatedAccount: boolean;

	@Column({ type: 'varchar', length: 32, default: EmailMemoWhatsAppStatus.DISCONNECTED })
	status: EmailMemoWhatsAppStatus;

	@Column({ name: 'device_name', type: 'varchar', length: 160, nullable: true })
	deviceName: string | null;

	@Column({ name: 'phone_number', type: 'varchar', length: 32, nullable: true })
	phoneNumber: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	jid: string | null;

	@Column({ name: 'encrypted_session', type: 'text', nullable: true })
	encryptedSession: string | null;

	@Column({ name: 'last_qr_at', type: 'timestamptz', nullable: true })
	lastQrAt: Date | null;

	@Column({ name: 'connected_at', type: 'timestamptz', nullable: true })
	connectedAt: Date | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('email_memo_whatsapp_messages')
export class EmailMemoWhatsAppMessage {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'gmail_message_id', type: 'uuid', nullable: true })
	gmailMessageId: string | null;

	@ManyToOne(() => EmailMemoGmailMessage, (row) => row.whatsappMessages, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'gmail_message_id' })
	gmailMessage: any;

	@Column({ name: 'ai_memo_id', type: 'uuid', nullable: true })
	aiMemoId: string | null;

	@Column({ name: 'chat_id', type: 'varchar', length: 160, nullable: true })
	chatId: string | null;

	@Column({ name: 'provider_message_id', type: 'varchar', length: 160, nullable: true })
	providerMessageId: string | null;

	@Column({ type: 'text' })
	body: string;

	@Column({ type: 'varchar', length: 32, default: EmailMemoDeliveryStatus.QUEUED })
	status: EmailMemoDeliveryStatus;

	@Column({ name: 'error_message', type: 'text', nullable: true })
	errorMessage: string | null;

	@Column({ name: 'attempt_count', type: 'int', default: 0 })
	attemptCount: number;

	@Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
	sentAt: Date | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('email_memo_notification_settings')
@Index('uq_email_memo_settings_user', ['userId'], { unique: true })
export class EmailMemoNotificationSettings {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'process_all_incoming', type: 'boolean', default: true })
	processAllIncoming: boolean;

	@Column({ name: 'only_unread', type: 'boolean', default: false })
	onlyUnread: boolean;

	@Column({ name: 'ignore_promotional', type: 'boolean', default: true })
	ignorePromotional: boolean;

	@Column({ name: 'ignore_newsletters', type: 'boolean', default: true })
	ignoreNewsletters: boolean;

	@Column({ name: 'gmail_query', type: 'varchar', length: 512, nullable: true })
	gmailQuery: string | null;

	@Column({ name: 'sender_include', type: 'jsonb', default: () => "'[]'::jsonb" })
	senderInclude: string[];

	@Column({ name: 'sender_exclude', type: 'jsonb', default: () => "'[]'::jsonb" })
	senderExclude: string[];

	@Column({ name: 'subject_include', type: 'jsonb', default: () => "'[]'::jsonb" })
	subjectInclude: string[];

	@Column({ name: 'gmail_labels', type: 'jsonb', default: () => `'["INBOX"]'::jsonb` })
	gmailLabels: string[];

	@Column({ name: 'min_priority', type: 'varchar', length: 16, default: 'low' })
	minPriority: string;

	@Column({ name: 'memo_length', type: 'varchar', length: 16, default: 'medium' })
	memoLength: string;

	@Column({ name: 'include_sender', type: 'boolean', default: true })
	includeSender: boolean;

	@Column({ name: 'include_subject', type: 'boolean', default: true })
	includeSubject: boolean;

	@Column({ name: 'include_summary', type: 'boolean', default: true })
	includeSummary: boolean;

	@Column({ name: 'include_action', type: 'boolean', default: true })
	includeAction: boolean;

	@Column({ name: 'include_deadline', type: 'boolean', default: true })
	includeDeadline: boolean;

	@Column({ name: 'include_gmail_link', type: 'boolean', default: true })
	includeGmailLink: boolean;

	@Column({ name: 'custom_instructions', type: 'text', nullable: true })
	customInstructions: string | null;

	@Column({ name: 'ai_provider', type: 'varchar', length: 32, default: 'ai-free' })
	aiProvider: string;

	@Column({ name: 'ai_model', type: 'varchar', length: 80, nullable: true })
	aiModel: string | null;

	@Column({ name: 'whatsapp_enabled', type: 'boolean', default: true })
	whatsappEnabled: boolean;

	@Column({ name: 'only_important', type: 'boolean', default: false })
	onlyImportant: boolean;

	@Column({ name: 'notification_mode', type: 'varchar', length: 24, default: 'immediate' })
	notificationMode: string;

	@Column({ name: 'target_chat_id', type: 'varchar', length: 160, nullable: true })
	targetChatId: string | null;

	@Column({ name: 'target_chat_name', type: 'varchar', length: 160, nullable: true })
	targetChatName: string | null;

	@Column({ name: 'poll_interval_hours', type: 'int', default: 1 })
	pollIntervalHours: number;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

@Entity('email_memo_processing_logs')
export class EmailMemoProcessingLog {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ name: 'gmail_message_id', type: 'uuid', nullable: true })
	gmailMessageId: string | null;

	@Column({ type: 'varchar', length: 40 })
	stage: string;

	@Column({ type: 'varchar', length: 16, default: 'info' })
	level: string;

	@Column({ type: 'text' })
	message: string;

	@Column({ type: 'jsonb', nullable: true })
	meta: Record<string, unknown> | null;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;
}

@Entity('email_memo_usage_daily')
@Index('uq_email_memo_usage_user_day', ['userId', 'day'], { unique: true })
export class EmailMemoUsageDaily {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@Column({ type: 'date' })
	day: string;

	@Column({ name: 'emails_processed', type: 'int', default: 0 })
	emailsProcessed: number;

	@Column({ name: 'ai_requests', type: 'int', default: 0 })
	aiRequests: number;

	@Column({ name: 'whatsapp_sent', type: 'int', default: 0 })
	whatsappSent: number;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	createdAt: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updatedAt: Date;
}

export const EMAIL_MEMO_ENTITIES = [
	EmailMemoGmailConnection,
	EmailMemoGmailMessage,
	EmailMemoAiMemo,
	EmailMemoWhatsAppConnection,
	EmailMemoWhatsAppMessage,
	EmailMemoNotificationSettings,
	EmailMemoProcessingLog,
	EmailMemoUsageDaily,
];
