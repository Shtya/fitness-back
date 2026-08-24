import {
	Column,
	Entity,
	Index,
	JoinColumn,
	ManyToOne,
	OneToMany,
	OneToOne,
	Unique,
} from 'typeorm';
import { CoreEntity } from '../../../entities/core.entity';
import { User } from '../../../entities/global.entity';

export enum WhatsAppAccountStatus {
	DISCONNECTED = 'disconnected',
	CONNECTING = 'connecting',
	QR_PENDING = 'qr_pending',
	CONNECTED = 'connected',
	ERROR = 'error',
}

export enum WhatsAppConversationType {
	DIRECT = 'direct',
	GROUP = 'group',
}

export enum WhatsAppMessageDirection {
	INBOUND = 'inbound',
	OUTBOUND = 'outbound',
}

export enum WhatsAppMessageStatus {
	PENDING = 'pending',
	SENT = 'sent',
	DELIVERED = 'delivered',
	READ = 'read',
	PLAYED = 'played',
	FAILED = 'failed',
}

@Entity('whatsapp_accounts')
export class WhatsAppAccount extends CoreEntity {
	@Column({ type: 'varchar', length: 120 })
	label: string;

	@Index()
	@Column({ name: 'owner_admin_id', type: 'uuid' })
	ownerAdminId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'owner_admin_id' })
	ownerAdmin: User;

	@Column({ name: 'phone_number', type: 'varchar', length: 40, nullable: true })
	phoneNumber: string | null;

	@Column({ name: 'provider_name', type: 'varchar', length: 40, default: 'baileys' })
	providerName: string;

	@Column({
		type: 'enum',
		enum: WhatsAppAccountStatus,
		enumName: 'whatsapp_account_status',
		default: WhatsAppAccountStatus.DISCONNECTED,
	})
	status: WhatsAppAccountStatus;

	@Column({ name: 'last_connected_at', type: 'timestamptz', nullable: true })
	lastConnectedAt: Date | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'initial_hydrated_at', type: 'timestamptz', nullable: true })
	initialHydratedAt: Date | null;

	@Column({ name: 'last_history_sync_at', type: 'timestamptz', nullable: true })
	lastHistorySyncAt: Date | null;

	@Column({ name: 'provider_capabilities', type: 'jsonb', default: () => "'{}'::jsonb" })
	providerCapabilities: Record<string, boolean | string>;

	@OneToMany(() => WhatsAppAccountAccess, access => access.account)
	access: WhatsAppAccountAccess[];

	@OneToMany(() => WhatsAppConversation, conversation => conversation.account)
	conversations: WhatsAppConversation[];
}

@Entity('whatsapp_account_access')
@Unique('uq_whatsapp_account_access', ['accountId', 'userId'])
export class WhatsAppAccountAccess extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, account => account.access, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ name: 'can_view', type: 'boolean', default: true })
	canView: boolean;

	@Column({ name: 'can_use', type: 'boolean', default: false })
	canUse: boolean;

	@Column({ name: 'can_manage', type: 'boolean', default: false })
	canManage: boolean;

	@Column({ name: 'can_assign', type: 'boolean', default: false })
	canAssign: boolean;

	@Column({ name: 'can_transfer', type: 'boolean', default: false })
	canTransfer: boolean;
}

@Entity('whatsapp_provider_sessions')
@Unique('uq_whatsapp_provider_session', ['accountId', 'providerName'])
export class WhatsAppProviderSession extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ name: 'provider_name', type: 'varchar', length: 40 })
	providerName: string;

	@Column({ name: 'encrypted_data', type: 'text' })
	encryptedData: string;

	@Column({ name: 'key_version', type: 'int', default: 1 })
	keyVersion: number;

	@Column({ name: 'is_active', type: 'boolean', default: true })
	isActive: boolean;
}

@Entity('whatsapp_contacts')
@Unique('uq_whatsapp_contact_account_wa_id', ['accountId', 'waId'])
export class WhatsAppContact extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ name: 'wa_id', type: 'varchar', length: 160 })
	waId: string;

	@Column({ name: 'phone_number', type: 'varchar', length: 40, nullable: true })
	phoneNumber: string | null;

	@Column({ type: 'varchar', length: 200, nullable: true })
	name: string | null;

	@Column({ name: 'avatar_url', type: 'varchar', length: 1024, nullable: true })
	avatarUrl: string | null;

	@Column({ name: 'is_business', type: 'boolean', default: false })
	isBusiness: boolean;
}

@Entity('whatsapp_groups')
@Unique('uq_whatsapp_group_account_wa_id', ['accountId', 'waId'])
export class WhatsAppGroup extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ name: 'wa_id', type: 'varchar', length: 160 })
	waId: string;

	@Column({ type: 'varchar', length: 240 })
	subject: string;

	@Column({ type: 'text', nullable: true })
	description: string | null;

	@Column({ name: 'owner_wa_id', type: 'varchar', length: 160, nullable: true })
	ownerWaId: string | null;

	@Column({ name: 'participant_count', type: 'int', default: 0 })
	participantCount: number;

	@Column({ name: 'avatar_url', type: 'varchar', length: 1024, nullable: true })
	avatarUrl: string | null;

	@Column({ name: 'metadata_synced_at', type: 'timestamptz', nullable: true })
	metadataSyncedAt: Date | null;

	@OneToMany(() => WhatsAppGroupParticipant, participant => participant.group)
	participants: WhatsAppGroupParticipant[];
}

@Entity('whatsapp_group_participants')
@Unique('uq_whatsapp_group_participant', ['groupId', 'waId'])
export class WhatsAppGroupParticipant extends CoreEntity {
	@Index()
	@Column({ name: 'group_id', type: 'uuid' })
	groupId: string;

	@ManyToOne(() => WhatsAppGroup, group => group.participants, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'group_id' })
	group: WhatsAppGroup;

	@Column({ name: 'wa_id', type: 'varchar', length: 160 })
	waId: string;

	@Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
	displayName: string | null;

	@Column({ name: 'is_admin', type: 'boolean', default: false })
	isAdmin: boolean;

	@Column({ name: 'is_super_admin', type: 'boolean', default: false })
	isSuperAdmin: boolean;
}

@Entity('whatsapp_conversations')
@Unique('uq_whatsapp_conversation_account_chat', ['accountId', 'providerChatId'])
export class WhatsAppConversation extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, account => account.conversations, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({
		type: 'enum',
		enum: WhatsAppConversationType,
		enumName: 'whatsapp_conversation_type',
	})
	type: WhatsAppConversationType;

	@Column({ name: 'provider_chat_id', type: 'varchar', length: 160 })
	providerChatId: string;

	@Column({ name: 'contact_id', type: 'uuid', nullable: true })
	contactId: string | null;

	@ManyToOne(() => WhatsAppContact, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'contact_id' })
	contact: WhatsAppContact | null;

	@Column({ name: 'group_id', type: 'uuid', nullable: true })
	groupId: string | null;

	@OneToOne(() => WhatsAppGroup, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'group_id' })
	group: WhatsAppGroup | null;

	@Index()
	@Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
	assignedUserId: string | null;

	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'assigned_user_id' })
	assignedUser: User | null;

	@Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
	lastMessageAt: Date | null;

	@Column({ name: 'last_provider_sync_at', type: 'timestamptz', nullable: true })
	lastProviderSyncAt: Date | null;

	@Column({ name: 'oldest_provider_cursor', type: 'varchar', length: 300, nullable: true })
	oldestProviderCursor: string | null;

	@Column({ name: 'has_more_provider_history', type: 'boolean', default: true })
	hasMoreProviderHistory: boolean;

	@Column({ name: 'unread_count', type: 'int', default: 0 })
	unreadCount: number;

	@Column({ name: 'is_closed', type: 'boolean', default: false })
	isClosed: boolean;

	@OneToMany(() => WhatsAppMessage, message => message.conversation)
	messages: WhatsAppMessage[];
}

@Entity('whatsapp_conversation_assignments')
export class WhatsAppConversationAssignment extends CoreEntity {
	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
	assignedUserId: string | null;

	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'assigned_user_id' })
	assignedUser: User | null;

	@Column({ name: 'assigned_by_user_id', type: 'uuid' })
	assignedByUserId: string;

	@ManyToOne(() => User, { onDelete: 'RESTRICT' })
	@JoinColumn({ name: 'assigned_by_user_id' })
	assignedByUser: User;

	@Column({ type: 'varchar', length: 20 })
	action: 'assign' | 'unassign' | 'transfer';

	@Column({ name: 'previous_user_id', type: 'uuid', nullable: true })
	previousUserId: string | null;

	@Column({ type: 'text', nullable: true })
	note: string | null;
}

@Entity('whatsapp_conversation_preferences')
@Unique('uq_whatsapp_conversation_preference', ['conversationId', 'userId'])
export class WhatsAppConversationPreference extends CoreEntity {
	@Index()
	@Column({ name: 'conversation_id', type: 'uuid', nullable: true })
	conversationId: string | null;

	@ManyToOne(() => WhatsAppConversation, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation | null;

	@Index()
	@Column({ name: 'account_id', type: 'uuid', nullable: true })
	accountId: string | null;

	@ManyToOne(() => WhatsAppAccount, { nullable: true, onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount | null;

	@Index()
	@Column({ name: 'provider_chat_id', type: 'varchar', length: 160, nullable: true })
	providerChatId: string | null;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ name: 'is_favorite', type: 'boolean', default: false })
	isFavorite: boolean;

	@Column({ name: 'is_pinned', type: 'boolean', default: false })
	isPinned: boolean;

	@Column({ name: 'is_archived', type: 'boolean', default: false })
	isArchived: boolean;
}

@Entity('whatsapp_messages')
@Unique('uq_whatsapp_message_account_provider', ['accountId', 'providerMessageId'])
@Index('idx_whatsapp_messages_conversation_timestamp', ['conversationId', 'providerTimestamp'])
export class WhatsAppMessage extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, conversation => conversation.messages, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Column({ name: 'provider_message_id', type: 'varchar', length: 300 })
	providerMessageId: string;

	@Column({ name: 'provider_name', type: 'varchar', length: 40 })
	providerName: string;

	@Column({
		type: 'enum',
		enum: WhatsAppMessageDirection,
		enumName: 'whatsapp_message_direction',
	})
	direction: WhatsAppMessageDirection;

	@Column({ name: 'sender_wa_id', type: 'varchar', length: 160, nullable: true })
	senderWaId: string | null;

	@Index()
	@Column({ name: 'sender_user_id', type: 'uuid', nullable: true })
	senderUserId: string | null;

	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'sender_user_id' })
	senderUser: User | null;

	@Column({ type: 'varchar', length: 40 })
	type: string;

	@Column({ type: 'text', nullable: true })
	text: string | null;

	@Column({
		type: 'enum',
		enum: WhatsAppMessageStatus,
		enumName: 'whatsapp_message_status',
		default: WhatsAppMessageStatus.PENDING,
	})
	status: WhatsAppMessageStatus;

	@Column({ name: 'status_updated_at', type: 'timestamptz', nullable: true })
	statusUpdatedAt: Date | null;

	@Column({ name: 'quoted_provider_message_id', type: 'varchar', length: 300, nullable: true })
	quotedProviderMessageId: string | null;

	@Column({ name: 'is_starred', type: 'boolean', default: false })
	isStarred: boolean;

	@Column({ name: 'is_forwarded', type: 'boolean', default: false })
	isForwarded: boolean;

	@Column({ name: 'is_pinned', type: 'boolean', default: false })
	isPinned: boolean;

	@Column({ name: 'pinned_until', type: 'timestamptz', nullable: true })
	pinnedUntil: Date | null;

	@Column({ name: 'deleted_mode', type: 'varchar', length: 20, default: 'none' })
	deletedMode: 'none' | 'local' | 'everyone';

	@Column({ name: 'provider_deleted_at', type: 'timestamptz', nullable: true })
	providerDeletedAt: Date | null;

	@Column({ name: 'provider_timestamp', type: 'timestamptz' })
	providerTimestamp: Date;

	@Column({ type: 'jsonb', nullable: true })
	raw: Record<string, any> | null;

	@OneToMany(() => WhatsAppMessageAttachment, attachment => attachment.message)
	attachments: WhatsAppMessageAttachment[];

	@OneToMany(() => WhatsAppMessageReaction, reaction => reaction.message)
	reactions: WhatsAppMessageReaction[];
}

@Entity('whatsapp_message_reactions')
@Unique('uq_whatsapp_message_reaction_actor', ['messageId', 'actorKey'])
export class WhatsAppMessageReaction extends CoreEntity {
	@Index()
	@Column({ name: 'message_id', type: 'uuid' })
	messageId: string;

	@ManyToOne(() => WhatsAppMessage, message => message.reactions, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'message_id' })
	message: WhatsAppMessage;

	@Column({ name: 'actor_key', type: 'varchar', length: 200 })
	actorKey: string;

	@Column({ type: 'varchar', length: 32 })
	emoji: string;

	@Column({ name: 'reacted_at', type: 'timestamptz', nullable: true })
	reactedAt: Date | null;
}

@Entity('whatsapp_message_attachments')
export class WhatsAppMessageAttachment extends CoreEntity {
	@Index()
	@Column({ name: 'message_id', type: 'uuid' })
	messageId: string;

	@ManyToOne(() => WhatsAppMessage, message => message.attachments, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'message_id' })
	message: WhatsAppMessage;

	@Column({ type: 'varchar', length: 40 })
	type: string;

	@Column({ name: 'mime_type', type: 'varchar', length: 160, nullable: true })
	mimeType: string | null;

	@Column({ name: 'file_name', type: 'varchar', length: 300, nullable: true })
	fileName: string | null;

	@Column({ name: 'file_size_bytes', type: 'bigint', nullable: true })
	fileSizeBytes: string | null;

	@Column({ name: 'provider_media_id', type: 'varchar', length: 300, nullable: true })
	providerMediaId: string | null;

	@Column({ name: 'storage_path', type: 'varchar', length: 1024, nullable: true })
	storagePath: string | null;

	@Column({ name: 'download_status', type: 'varchar', length: 30, default: 'pending' })
	downloadStatus: 'pending' | 'downloading' | 'downloaded' | 'failed';
}

@Entity('whatsapp_statuses')
@Unique('uq_whatsapp_status_account_provider', ['accountId', 'providerStatusId'])
export class WhatsAppStatus extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ name: 'provider_status_id', type: 'varchar', length: 300 })
	providerStatusId: string;

	@Column({ name: 'sender_wa_id', type: 'varchar', length: 160, nullable: true })
	senderWaId: string | null;

	@Column({ type: 'varchar', length: 40 })
	type: string;

	@Column({ type: 'text', nullable: true })
	caption: string | null;

	@Column({ name: 'is_own', type: 'boolean', default: false })
	isOwn: boolean;

	@Column({ name: 'published_at', type: 'timestamptz' })
	publishedAt: Date;

	@Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
	expiresAt: Date | null;

	@Column({ name: 'media_path', type: 'varchar', length: 1024, nullable: true })
	mediaPath: string | null;
}

@Entity('whatsapp_connection_logs')
export class WhatsAppConnectionLog extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ type: 'varchar', length: 80 })
	event: string;

	@Column({ type: 'text', nullable: true })
	message: string | null;

	@Column({ type: 'jsonb', nullable: true })
	metadata: Record<string, any> | null;
}

@Entity('whatsapp_audit_logs')
export class WhatsAppAuditLog extends CoreEntity {
	@Index()
	@Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
	actorUserId: string | null;

	@ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
	@JoinColumn({ name: 'actor_user_id' })
	actor: User | null;

	@Index()
	@Column({ name: 'account_id', type: 'uuid', nullable: true })
	accountId: string | null;

	@Column({ type: 'varchar', length: 120 })
	action: string;

	@Column({ name: 'target_type', type: 'varchar', length: 80, nullable: true })
	targetType: string | null;

	@Column({ name: 'target_id', type: 'varchar', length: 160, nullable: true })
	targetId: string | null;

	@Column({ type: 'jsonb', nullable: true })
	metadata: Record<string, any> | null;
}

@Entity('whatsapp_conversation_notes')
@Index('idx_whatsapp_conversation_notes_conversation', ['conversationId', 'created_at'])
export class WhatsAppConversationNote extends CoreEntity {
	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Index()
	@Column({ name: 'author_user_id', type: 'uuid' })
	authorUserId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'author_user_id' })
	author: User;

	@Column({ type: 'text' })
	text: string;
}

@Entity('whatsapp_voice_changer_settings')
export class WhatsAppVoiceChangerSettings extends CoreEntity {
	@Index({ unique: true })
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ type: 'boolean', default: false })
	configured: boolean;

	@Column({ type: 'boolean', default: false })
	enabled: boolean;

	@Column({ type: 'varchar', length: 32, default: 'off' })
	provider: string;

	@Column({ type: 'varchar', length: 40, default: 'deeper' })
	preset: string;

	@Column({ name: 'pitch_semitones', type: 'int', default: -5 })
	pitchSemitones: number;

	@Column({ name: 'voice_id', type: 'varchar', length: 120, nullable: true })
	voiceId: string | null;
}

@Entity('whatsapp_voice_changer_credentials')
@Unique('uq_wa_voice_changer_user_provider', ['userId', 'provider'])
export class WhatsAppVoiceChangerCredential extends CoreEntity {
	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ type: 'varchar', length: 32 })
	provider: string;

	@Column({ name: 'encrypted_api_key', type: 'text' })
	encryptedApiKey: string;

	@Column({ name: 'key_last_four', type: 'varchar', length: 8 })
	keyLastFour: string;
}

@Entity('whatsapp_saved_stickers')
@Unique('uq_whatsapp_saved_sticker_hash', ['accountId', 'fileHash'])
export class WhatsAppSavedSticker extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ name: 'file_hash', type: 'varchar', length: 64 })
	fileHash: string;

	@Column({ name: 'mime_type', type: 'varchar', length: 160 })
	mimeType: string;

	@Column({ name: 'file_name', type: 'varchar', length: 300, nullable: true })
	fileName: string | null;

	@Column({ name: 'storage_path', type: 'varchar', length: 1024 })
	storagePath: string;

	@Column({ type: 'varchar', length: 20, default: 'upload' })
	source: 'upload' | 'history';

	@Column({ name: 'is_animated', type: 'boolean', default: false })
	isAnimated: boolean;
}

@Entity('whatsapp_chat_message_groups')
@Index('idx_whatsapp_chat_message_groups_conversation', ['conversationId'])
export class WhatsAppChatMessageGroup extends CoreEntity {
	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;

	@Column({ type: 'varchar', length: 120 })
	name: string;
}

@Entity('whatsapp_chat_message_group_items')
@Index('idx_whatsapp_chat_message_group_items_group', ['groupId'])
@Index('idx_whatsapp_chat_message_group_items_conversation', ['conversationId'])
export class WhatsAppChatMessageGroupItem extends CoreEntity {
	@Index()
	@Column({ name: 'group_id', type: 'uuid' })
	groupId: string;

	@ManyToOne(() => WhatsAppChatMessageGroup, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'group_id' })
	group: WhatsAppChatMessageGroup;

	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Index()
	@Column({ name: 'message_id', type: 'uuid' })
	messageId: string;

	@ManyToOne(() => WhatsAppMessage, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'message_id' })
	message: WhatsAppMessage;

	@Index()
	@Column({ name: 'user_id', type: 'uuid' })
	userId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'user_id' })
	user: User;
}

export enum WhatsAppMessageScheduleKind {
	ONCE = 'once',
	RECURRING = 'recurring',
}

export enum WhatsAppMessageScheduleStatus {
	ACTIVE = 'active',
	PAUSED = 'paused',
	PROCESSING = 'processing',
	COMPLETED = 'completed',
	CANCELLED = 'cancelled',
}

export enum WhatsAppMessageScheduleRecipientStatus {
	ACTIVE = 'active',
	REMOVED = 'removed',
}

export enum WhatsAppMessageScheduleRunStatus {
	RUNNING = 'running',
	COMPLETED = 'completed',
	PARTIAL = 'partial',
	FAILED = 'failed',
}

export enum WhatsAppMessageScheduleDeliveryStatus {
	PENDING = 'pending',
	SENT = 'sent',
	FAILED = 'failed',
	SKIPPED = 'skipped',
}

@Entity('whatsapp_message_schedules')
@Index('idx_whatsapp_message_schedules_account', ['accountId'])
export class WhatsAppMessageSchedule extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Index()
	@Column({ name: 'created_by_user_id', type: 'uuid' })
	createdByUserId: string;

	@ManyToOne(() => User, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'created_by_user_id' })
	createdByUser: User;

	@Column({ type: 'varchar', length: 160, nullable: true })
	title: string | null;

	@Column({ type: 'varchar', length: 32, default: 'text' })
	type: string;

	@Column({ type: 'text', nullable: true })
	text: string | null;

	@Column({ type: 'text', nullable: true })
	caption: string | null;

	@Column({ name: 'file_id', type: 'varchar', length: 1024, nullable: true })
	fileId: string | null;

	@Column({ name: 'quoted_provider_message_id', type: 'varchar', length: 128, nullable: true })
	quotedProviderMessageId: string | null;

	@Column({ name: 'schedule_kind', type: 'varchar', length: 16, default: 'once' })
	scheduleKind: WhatsAppMessageScheduleKind;

	@Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
	scheduledAt: Date | null;

	@Column({ name: 'time_of_day', type: 'varchar', length: 8, nullable: true })
	timeOfDay: string | null;

	@Column({ type: 'varchar', length: 64, default: 'Asia/Qatar' })
	timezone: string;

	@Column({ name: 'days_of_week', type: 'jsonb', default: () => "'[]'::jsonb" })
	daysOfWeek: number[];

	@Column({ name: 'recurrence_start_date', type: 'date', nullable: true })
	recurrenceStartDate: string | null;

	@Column({ name: 'recurrence_end_date', type: 'date', nullable: true })
	recurrenceEndDate: string | null;

	@Index()
	@Column({ name: 'next_run_at', type: 'timestamptz', nullable: true })
	nextRunAt: Date | null;

	@Column({ name: 'last_run_at', type: 'timestamptz', nullable: true })
	lastRunAt: Date | null;

	@Index()
	@Column({ type: 'varchar', length: 16, default: 'active' })
	status: WhatsAppMessageScheduleStatus;

	@Column({ name: 'client_message_id', type: 'varchar', length: 120, nullable: true })
	clientMessageId: string | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@OneToMany(() => WhatsAppMessageScheduleRecipient, recipient => recipient.schedule)
	recipients: WhatsAppMessageScheduleRecipient[];

	@OneToMany(() => WhatsAppMessageScheduleRun, run => run.schedule)
	runs: WhatsAppMessageScheduleRun[];
}

@Entity('whatsapp_message_schedule_recipients')
@Unique('uq_whatsapp_message_schedule_recipient', ['scheduleId', 'conversationId'])
export class WhatsAppMessageScheduleRecipient extends CoreEntity {
	@Index()
	@Column({ name: 'schedule_id', type: 'uuid' })
	scheduleId: string;

	@ManyToOne(() => WhatsAppMessageSchedule, schedule => schedule.recipients, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'schedule_id' })
	schedule: WhatsAppMessageSchedule;

	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Column({ type: 'varchar', length: 16, default: 'active' })
	status: WhatsAppMessageScheduleRecipientStatus;

	@Column({ name: 'last_sent_at', type: 'timestamptz', nullable: true })
	lastSentAt: Date | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;
}

@Entity('whatsapp_message_schedule_runs')
export class WhatsAppMessageScheduleRun extends CoreEntity {
	@Index()
	@Column({ name: 'schedule_id', type: 'uuid' })
	scheduleId: string;

	@ManyToOne(() => WhatsAppMessageSchedule, schedule => schedule.runs, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'schedule_id' })
	schedule: WhatsAppMessageSchedule;

	@Column({ name: 'run_at', type: 'timestamptz', default: () => 'now()' })
	runAt: Date;

	@Column({ type: 'varchar', length: 16, default: 'running' })
	status: WhatsAppMessageScheduleRunStatus;

	@Column({ name: 'total_recipients', type: 'int', default: 0 })
	totalRecipients: number;

	@Column({ name: 'sent_count', type: 'int', default: 0 })
	sentCount: number;

	@Column({ name: 'failed_count', type: 'int', default: 0 })
	failedCount: number;

	@OneToMany(() => WhatsAppMessageScheduleDelivery, delivery => delivery.run)
	deliveries: WhatsAppMessageScheduleDelivery[];
}

@Entity('whatsapp_message_schedule_deliveries')
export class WhatsAppMessageScheduleDelivery extends CoreEntity {
	@Index()
	@Column({ name: 'run_id', type: 'uuid' })
	runId: string;

	@ManyToOne(() => WhatsAppMessageScheduleRun, run => run.deliveries, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'run_id' })
	run: WhatsAppMessageScheduleRun;

	@Index()
	@Column({ name: 'schedule_id', type: 'uuid' })
	scheduleId: string;

	@ManyToOne(() => WhatsAppMessageSchedule, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'schedule_id' })
	schedule: WhatsAppMessageSchedule;

	@Index()
	@Column({ name: 'recipient_id', type: 'uuid' })
	recipientId: string;

	@ManyToOne(() => WhatsAppMessageScheduleRecipient, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'recipient_id' })
	recipient: WhatsAppMessageScheduleRecipient;

	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Column({ type: 'varchar', length: 16, default: 'pending' })
	status: WhatsAppMessageScheduleDeliveryStatus;

	@Column({ name: 'sent_message_id', type: 'uuid', nullable: true })
	sentMessageId: string | null;

	@Column({ name: 'attempt_count', type: 'int', default: 0 })
	attemptCount: number;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'client_message_id', type: 'varchar', length: 160 })
	clientMessageId: string;
}

@Entity('whatsapp_boards')
@Index('idx_whatsapp_boards_account', ['accountId'])
export class WhatsAppBoard extends CoreEntity {
	@Index()
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@ManyToOne(() => WhatsAppAccount, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'account_id' })
	account: WhatsAppAccount;

	@Column({ type: 'varchar', length: 120, default: 'Tasks' })
	name: string;

	@Column({ name: 'is_default', type: 'boolean', default: false })
	isDefault: boolean;

	@Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
	createdByUserId: string | null;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'created_by_user_id' })
	createdByUser: User | null;

	@OneToMany(() => WhatsAppBoardColumn, (column) => column.board)
	columns: WhatsAppBoardColumn[];
}

@Entity('whatsapp_board_columns')
@Index('idx_whatsapp_board_columns_board', ['boardId', 'orderIndex'])
export class WhatsAppBoardColumn extends CoreEntity {
	@Index()
	@Column({ name: 'board_id', type: 'uuid' })
	boardId: string;

	@ManyToOne(() => WhatsAppBoard, (board) => board.columns, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'board_id' })
	board: WhatsAppBoard;

	@Column({ type: 'varchar', length: 120 })
	name: string;

	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex: number;

	@Column({ type: 'varchar', length: 32, nullable: true })
	color: string | null;
}

@Entity('whatsapp_board_cards')
@Index('idx_whatsapp_board_cards_column', ['columnId', 'orderIndex'])
@Index('idx_whatsapp_board_cards_board', ['boardId'])
export class WhatsAppBoardCard extends CoreEntity {
	@Index()
	@Column({ name: 'board_id', type: 'uuid' })
	boardId: string;

	@ManyToOne(() => WhatsAppBoard, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'board_id' })
	board: WhatsAppBoard;

	@Index()
	@Column({ name: 'column_id', type: 'uuid' })
	columnId: string;

	@ManyToOne(() => WhatsAppBoardColumn, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'column_id' })
	column: WhatsAppBoardColumn;

	@Column({ type: 'varchar', length: 500 })
	title: string;

	@Column({ type: 'text', nullable: true })
	description: string | null;

	@Column({ name: 'order_index', type: 'int', default: 0 })
	orderIndex: number;

	@Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
	assignedUserId: string | null;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'assigned_user_id' })
	assignedUser: User | null;

	@Column({ name: 'conversation_id', type: 'uuid', nullable: true })
	conversationId: string | null;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation | null;

	@Column({ name: 'due_at', type: 'timestamptz', nullable: true })
	dueAt: Date | null;

	@Column({ name: 'is_starred', type: 'boolean', default: false })
	isStarred: boolean;

	@Column({ type: 'varchar', length: 16, default: 'medium' })
	priority: string;

	@Column({ name: 'is_completed', type: 'boolean', default: false })
	isCompleted: boolean;

	@Column({ type: 'jsonb', default: () => "'[]'" })
	labels: Array<{ id: string; name: string; color: string }>;

	@Column({ type: 'jsonb', default: () => "'[]'" })
	checklist: Array<{ id: string; text: string; completed: boolean }>;

	@Column({ type: 'jsonb', default: () => "'[]'" })
	comments: Array<Record<string, unknown>>;

	@Column({ type: 'jsonb', default: () => "'[]'" })
	attachments: Array<Record<string, unknown>>;

	@Column({ name: 'cover_image_url', type: 'text', nullable: true })
	coverImageUrl: string | null;

	@Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
	createdByUserId: string | null;

	@ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'created_by_user_id' })
	createdByUser: User | null;

	@OneToMany(() => WhatsAppBoardCardLink, (link) => link.card)
	links: WhatsAppBoardCardLink[];
}

@Entity('whatsapp_board_card_links')
@Index('idx_whatsapp_board_card_links_card', ['cardId'])
export class WhatsAppBoardCardLink extends CoreEntity {
	@Index()
	@Column({ name: 'card_id', type: 'uuid' })
	cardId: string;

	@ManyToOne(() => WhatsAppBoardCard, (card) => card.links, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'card_id' })
	card: WhatsAppBoardCard;

	@Index()
	@Column({ name: 'message_id', type: 'uuid' })
	messageId: string;

	@ManyToOne(() => WhatsAppMessage, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'message_id' })
	message: WhatsAppMessage;

	@Index()
	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@ManyToOne(() => WhatsAppConversation, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'conversation_id' })
	conversation: WhatsAppConversation;

	@Column({ type: 'text', nullable: true })
	snippet: string | null;

	@Column({ name: 'message_type', type: 'varchar', length: 40, nullable: true })
	messageType: string | null;
}
