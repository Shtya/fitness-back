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

	@Column({ name: 'provider_name', type: 'varchar', length: 40, default: 'wppconnect' })
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

	@Column({ name: 'is_favorite', type: 'boolean', default: false })
	isFavorite: boolean;

	@Column({ name: 'is_pinned', type: 'boolean', default: false })
	isPinned: boolean;
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
