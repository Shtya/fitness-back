import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum DemoConversationSourceType {
  FAKE = 'fake',
  REAL_OVERLAY = 'real_overlay',
}

export enum DemoMessageDirection {
  INBOUND = 'inbound',
  OUTBOUND = 'outbound',
  SYSTEM = 'system',
}

export enum DemoMessageStatus {
  PENDING = 'pending',
  SENT = 'sent',
  DELIVERED = 'delivered',
  READ = 'read',
  PLAYED = 'played',
  FAILED = 'failed',
}

export enum DemoDeletedMode {
  NONE = 'none',
  FOR_ME = 'for_me',
  FOR_EVERYONE = 'for_everyone',
}

export enum DemoPresenceStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  AWAY = 'away',
  TYPING = 'typing',
  RECORDING = 'recording',
}

export enum DemoEventType {
  TYPING = 'typing',
  RECORDING = 'recording',
  INCOMING_MESSAGE = 'incoming_message',
}

export enum DemoAttachmentKind {
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
}

abstract class DemoBaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

abstract class OwnedDemoEntity extends DemoBaseEntity {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index()
  @Column({ name: 'tenant_admin_id', type: 'uuid' })
  tenantAdminId!: string;
}

@Entity('whatsapp_demo_profiles')
@Index(['userId', 'tenantAdminId'])
export class WhatsAppDemoProfile extends OwnedDemoEntity {
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'varchar', length: 20, default: 'en' })
  locale!: string;

  @Column({ name: 'random_seed', type: 'int', default: 1 })
  randomSeed!: number;

  @OneToMany(() => WhatsAppDemoContact, (contact) => contact.profile)
  contacts?: WhatsAppDemoContact[];

  @OneToMany(() => WhatsAppDemoConversation, (conversation) => conversation.profile)
  conversations?: WhatsAppDemoConversation[];

  @OneToMany(() => WhatsAppDemoEvent, (event) => event.profile)
  events?: WhatsAppDemoEvent[];
}

@Entity('whatsapp_demo_settings')
@Unique('uq_whatsapp_demo_settings_owner', ['userId', 'tenantAdminId'])
export class WhatsAppDemoSettings extends OwnedDemoEntity {
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ name: 'active_profile_id', type: 'uuid', nullable: true })
  activeProfileId!: string | null;

  @ManyToOne(() => WhatsAppDemoProfile, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'active_profile_id' })
  activeProfile?: WhatsAppDemoProfile | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  flags!: Record<string, boolean>;
}

@Entity('whatsapp_demo_contacts')
@Index(['profileId', 'userId', 'tenantAdminId'])
export class WhatsAppDemoContact extends OwnedDemoEntity {
  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => WhatsAppDemoProfile, (profile) => profile.contacts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: WhatsAppDemoProfile;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'photo_attachment_id', type: 'uuid', nullable: true })
  photoAttachmentId!: string | null;

  @ManyToOne(() => WhatsAppDemoAttachment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'photo_attachment_id' })
  photoAttachment?: any;

  @Column({ name: 'avatar_color', type: 'varchar', length: 32, nullable: true })
  avatarColor!: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone!: string | null;

  @Column({ type: 'text', nullable: true })
  about!: string | null;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ name: 'presence_status', type: 'enum', enum: DemoPresenceStatus, default: DemoPresenceStatus.OFFLINE })
  presenceStatus!: DemoPresenceStatus;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;
}

@Entity('whatsapp_demo_conversations')
@Index(['profileId', 'userId', 'tenantAdminId'])
@Unique('uq_demo_real_overlay', ['profileId', 'realAccountId', 'realConversationId'])
export class WhatsAppDemoConversation extends OwnedDemoEntity {
  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => WhatsAppDemoProfile, (profile) => profile.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: WhatsAppDemoProfile;

  @Column({ name: 'source_type', type: 'enum', enum: DemoConversationSourceType })
  sourceType!: DemoConversationSourceType;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId!: string | null;

  @ManyToOne(() => WhatsAppDemoContact, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact?: WhatsAppDemoContact | null;

  @Column({ name: 'real_account_id', type: 'varchar', length: 255, nullable: true })
  realAccountId!: string | null;

  @Column({ name: 'real_conversation_id', type: 'varchar', length: 255, nullable: true })
  realConversationId!: string | null;

  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @Column({ type: 'boolean', default: false })
  archived!: boolean;

  @Column({ name: 'unread_count', type: 'int', default: 0 })
  unreadCount!: number;

  @Column({ name: 'muted_until', type: 'timestamptz', nullable: true })
  mutedUntil!: Date | null;

  @Column({ name: 'manual_order', type: 'int', default: 0 })
  manualOrder!: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  overrides!: Record<string, unknown>;

  @OneToMany(() => WhatsAppDemoMessage, (message) => message.conversation)
  messages?: WhatsAppDemoMessage[];
}

@Entity('whatsapp_demo_messages')
@Index(['conversationId', 'timestamp'])
@Index(['userId', 'tenantAdminId'])
export class WhatsAppDemoMessage extends OwnedDemoEntity {
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @ManyToOne(() => WhatsAppDemoConversation, (conversation) => conversation.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: WhatsAppDemoConversation;

  @Column({ type: 'enum', enum: DemoMessageDirection })
  direction!: DemoMessageDirection;

  @Column({ type: 'varchar', length: 40 })
  type!: string;

  @Column({ type: 'text', nullable: true })
  text!: string | null;

  @Column({ type: 'timestamptz' })
  timestamp!: Date;

  @Column({ type: 'enum', enum: DemoMessageStatus, default: DemoMessageStatus.SENT })
  status!: DemoMessageStatus;

  @Column({ name: 'show_read_receipt', type: 'boolean', default: true })
  showReadReceipt!: boolean;

  @Column({ name: 'reply_to_id', type: 'uuid', nullable: true })
  replyToId!: string | null;

  @ManyToOne(() => WhatsAppDemoMessage, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reply_to_id' })
  replyTo?: WhatsAppDemoMessage | null;

  @Column({ type: 'boolean', default: false })
  forwarded!: boolean;

  @Column({ name: 'edited_at', type: 'timestamptz', nullable: true })
  editedAt!: Date | null;

  @Column({ name: 'deleted_mode', type: 'enum', enum: DemoDeletedMode, default: DemoDeletedMode.NONE })
  deletedMode!: DemoDeletedMode;

  @Column({ type: 'jsonb', nullable: true })
  location!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @OneToMany(() => WhatsAppDemoAttachment, (attachment) => attachment.message)
  attachments?: WhatsAppDemoAttachment[];

  @OneToMany(() => WhatsAppDemoReaction, (reaction) => reaction.message)
  reactions?: WhatsAppDemoReaction[];
}

@Entity('whatsapp_demo_attachments')
@Index(['profileId', 'userId', 'tenantAdminId'])
export class WhatsAppDemoAttachment extends OwnedDemoEntity {
  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => WhatsAppDemoProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: WhatsAppDemoProfile;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId!: string | null;

  @ManyToOne(() => WhatsAppDemoMessage, (message) => message.attachments, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message?: WhatsAppDemoMessage | null;

  @Column({ type: 'enum', enum: DemoAttachmentKind })
  kind!: DemoAttachmentKind;

  @Column({ name: 'storage_key', type: 'varchar', length: 500 })
  storageKey!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 120 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;
}

@Entity('whatsapp_demo_reactions')
@Index(['messageId', 'userId', 'tenantAdminId'])
export class WhatsAppDemoReaction extends OwnedDemoEntity {
  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @ManyToOne(() => WhatsAppDemoMessage, (message) => message.reactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message!: WhatsAppDemoMessage;

  @Column({ type: 'varchar', length: 32 })
  emoji!: string;

  @Column({ name: 'actor_key', type: 'varchar', length: 160, default: 'contact' })
  actorKey!: string;
}

@Entity('whatsapp_demo_events')
@Index(['profileId', 'enabled', 'sequence'])
@Index(['userId', 'tenantAdminId'])
export class WhatsAppDemoEvent extends OwnedDemoEntity {
  @Column({ name: 'profile_id', type: 'uuid' })
  profileId!: string;

  @ManyToOne(() => WhatsAppDemoProfile, (profile) => profile.events, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'profile_id' })
  profile!: WhatsAppDemoProfile;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @ManyToOne(() => WhatsAppDemoConversation, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: WhatsAppDemoConversation | null;

  @Column({ name: 'event_type', type: 'enum', enum: DemoEventType })
  eventType!: DemoEventType;

  @Column({ name: 'delay_ms', type: 'int', default: 0 })
  delayMs!: number;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'boolean', default: false })
  infinite!: boolean;

  @Column({ type: 'boolean', default: false })
  randomize!: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'int', default: 0 })
  sequence!: number;
}
