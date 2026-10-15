import {
	Column,
	CreateDateColumn,
	Entity,
	Index,
	PrimaryColumn,
	PrimaryGeneratedColumn,
	Unique,
	UpdateDateColumn,
} from 'typeorm';
import type { AiReplyProviderName } from '../entities/whatsapp-ai-settings.entity';

export const AGENT_SCOPES = ['all', 'selected'] as const;
export const AGENT_DEFAULT_MODES = ['auto', 'suggest'] as const;
export const AGENT_CONVERSATION_MODES = ['inherit', 'auto', 'suggest', 'off'] as const;
export const AGENT_DIALECTS = ['auto', 'msa', 'egyptian', 'gulf', 'levantine', 'english'] as const;
export const AGENT_TONES = ['professional', 'friendly', 'sales', 'support', 'formal', 'concise'] as const;
export const AGENT_REPLY_LENGTHS = ['short', 'medium', 'detailed'] as const;
export const AGENT_MEDIA_POLICIES = ['handoff', 'acknowledge', 'ignore'] as const;
export const KNOWLEDGE_CATEGORIES = ['project', 'service', 'price', 'policy', 'faq', 'other'] as const;
export const AGENT_STATUSES = [
	'idle',
	'waiting',
	'generating',
	'replied',
	'suggested',
	'handoff',
	'paused',
	'error',
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];
export type AgentDefaultMode = (typeof AGENT_DEFAULT_MODES)[number];
export type AgentConversationMode = (typeof AGENT_CONVERSATION_MODES)[number];
export type AgentEffectiveMode = 'auto' | 'suggest' | 'off';
export type AgentDialect = (typeof AGENT_DIALECTS)[number];
export type AgentTone = (typeof AGENT_TONES)[number];
export type AgentReplyLength = (typeof AGENT_REPLY_LENGTHS)[number];
export type AgentMediaPolicy = (typeof AGENT_MEDIA_POLICIES)[number];
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export interface AgentPermissions {
	/** May state prices that appear in the knowledge base. */
	quotePrices: boolean;
	/** May promise delivery dates, callbacks, bookings or other commitments. */
	makeCommitments: boolean;
	/** May offer discounts or special terms. */
	offerDiscounts: boolean;
	/** May share links that appear in the knowledge base. */
	shareLinks: boolean;
}

export const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
	quotePrices: true,
	makeCommitments: false,
	offerDiscounts: false,
	shareLinks: true,
};

export interface AgentPendingSuggestion {
	runId: string;
	text: string;
	reasons: string[];
	sources: AgentSourceRef[];
	createdAt: string;
	triggerMessageId: string;
}

export interface AgentSourceRef {
	type: 'knowledge' | 'memory' | 'history';
	id?: string;
	title?: string;
	category?: string;
	score?: number;
}

export interface AgentMemoryItem {
	text: string;
	at: string;
}

@Entity('whatsapp_ai_agent_settings')
export class WhatsAppAiAgentSettings {
	@PrimaryColumn({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	created_at: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updated_at: Date;

	@Column({ type: 'boolean', default: false })
	enabled: boolean;

	@Column({ type: 'varchar', length: 20, default: 'selected' })
	scope: AgentScope;

	@Column({ name: 'default_mode', type: 'varchar', length: 20, default: 'suggest' })
	defaultMode: AgentDefaultMode;

	@Column({ type: 'varchar', length: 40, default: 'ai-free' })
	provider: AiReplyProviderName;

	@Column({ type: 'varchar', length: 80, default: 'auto' })
	model: string;

	@Column({ name: 'agent_name', type: 'varchar', length: 80, nullable: true })
	agentName: string | null;

	@Column({ name: 'business_name', type: 'varchar', length: 120, nullable: true })
	businessName: string | null;

	@Column({ type: 'text', nullable: true })
	persona: string | null;

	@Column({ type: 'varchar', length: 30, default: 'auto' })
	dialect: AgentDialect;

	@Column({ type: 'varchar', length: 20, default: 'professional' })
	tone: AgentTone;

	@Column({ name: 'reply_length', type: 'varchar', length: 20, default: 'short' })
	replyLength: AgentReplyLength;

	@Column({ type: 'text', nullable: true })
	rules: string | null;

	@Column({ name: 'allowed_topics', type: 'jsonb', default: () => "'[]'::jsonb" })
	allowedTopics: string[];

	@Column({ name: 'forbidden_topics', type: 'jsonb', default: () => "'[]'::jsonb" })
	forbiddenTopics: string[];

	@Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
	permissions: Partial<AgentPermissions>;

	@Column({ name: 'use_knowledge_base', type: 'boolean', default: true })
	useKnowledgeBase: boolean;

	@Column({ name: 'knowledge_only', type: 'boolean', default: true })
	knowledgeOnly: boolean;

	@Column({ name: 'use_contact_memory', type: 'boolean', default: true })
	useContactMemory: boolean;

	@Column({ name: 'context_message_limit', type: 'smallint', default: 12 })
	contextMessageLimit: number;

	@Column({ name: 'disclose_ai', type: 'boolean', default: true })
	discloseAi: boolean;

	@Column({ name: 'disclosure_text', type: 'text', nullable: true })
	disclosureText: string | null;

	@Column({ name: 'handoff_keywords', type: 'jsonb', default: () => "'[]'::jsonb" })
	handoffKeywords: string[];

	@Column({ name: 'handoff_message', type: 'text', nullable: true })
	handoffMessage: string | null;

	@Column({ name: 'media_policy', type: 'varchar', length: 20, default: 'handoff' })
	mediaPolicy: AgentMediaPolicy;

	@Column({ name: 'allow_groups', type: 'boolean', default: false })
	allowGroups: boolean;

	@Column({ name: 'debounce_seconds', type: 'smallint', default: 8 })
	debounceSeconds: number;

	@Column({ name: 'human_pause_minutes', type: 'smallint', default: 30 })
	humanPauseMinutes: number;

	@Column({ name: 'max_replies_per_hour', type: 'smallint', default: 12 })
	maxRepliesPerHour: number;

	@Column({ name: 'min_confidence', type: 'real', default: 0.55 })
	minConfidence: number;

	@Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
	actorUserId: string | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;
}

@Entity('whatsapp_ai_agent_conversations')
export class WhatsAppAiAgentConversation {
	@PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@Index('idx_whatsapp_ai_agent_conversations_account')
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	created_at: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updated_at: Date;

	@Column({ type: 'varchar', length: 20, default: 'inherit' })
	mode: AgentConversationMode;

	@Column({ type: 'varchar', length: 20, default: 'idle' })
	status: AgentStatus;

	@Column({ name: 'status_reason', type: 'varchar', length: 60, nullable: true })
	statusReason: string | null;

	@Column({ name: 'paused_until', type: 'timestamptz', nullable: true })
	pausedUntil: Date | null;

	@Column({ name: 'last_reply_at', type: 'timestamptz', nullable: true })
	lastReplyAt: Date | null;

	@Column({ name: 'last_error', type: 'text', nullable: true })
	lastError: string | null;

	@Column({ name: 'pending_suggestion', type: 'jsonb', nullable: true })
	pendingSuggestion: AgentPendingSuggestion | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;
}

@Entity('whatsapp_ai_knowledge_entries')
export class WhatsAppAiKnowledgeEntry {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	created_at: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updated_at: Date;

	@Column({ type: 'varchar', length: 20, default: 'faq' })
	category: KnowledgeCategory;

	@Column({ type: 'varchar', length: 200 })
	title: string;

	@Column({ type: 'text' })
	content: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	tags: string[];

	@Column({ name: 'is_active', type: 'boolean', default: true })
	isActive: boolean;

	@Column({ name: 'created_by', type: 'uuid', nullable: true })
	createdBy: string | null;

	@Column({ name: 'updated_by', type: 'uuid', nullable: true })
	updatedBy: string | null;
}

@Entity('whatsapp_ai_contact_memory')
export class WhatsAppAiContactMemory {
	@PrimaryColumn({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@Index('idx_whatsapp_ai_contact_memory_account')
	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	created_at: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updated_at: Date;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	facts: AgentMemoryItem[];

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	commitments: AgentMemoryItem[];
}

@Entity('whatsapp_ai_agent_runs')
@Unique('uq_whatsapp_ai_agent_run_trigger', ['conversationId', 'triggerMessageId'])
export class WhatsAppAiAgentRun {
	@PrimaryGeneratedColumn('uuid')
	id: string;

	@Column({ name: 'account_id', type: 'uuid' })
	accountId: string;

	@Column({ name: 'conversation_id', type: 'uuid' })
	conversationId: string;

	@Column({ name: 'trigger_message_id', type: 'uuid' })
	triggerMessageId: string;

	@CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
	created_at: Date;

	@UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
	updated_at: Date;

	@Column({ type: 'varchar', length: 20, default: 'running' })
	outcome: string;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	reasons: string[];

	@Column({ type: 'text', nullable: true })
	reply: string | null;

	@Column({ name: 'reply_message_id', type: 'uuid', nullable: true })
	replyMessageId: string | null;

	@Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
	sources: AgentSourceRef[];

	@Column({ type: 'varchar', length: 40, nullable: true })
	provider: string | null;

	@Column({ type: 'varchar', length: 120, nullable: true })
	model: string | null;

	@Column({ name: 'latency_ms', type: 'integer', nullable: true })
	latencyMs: number | null;

	@Column({ type: 'text', nullable: true })
	error: string | null;
}

export const AI_AGENT_ENTITIES = [
	WhatsAppAiAgentSettings,
	WhatsAppAiAgentConversation,
	WhatsAppAiKnowledgeEntry,
	WhatsAppAiContactMemory,
	WhatsAppAiAgentRun,
];
