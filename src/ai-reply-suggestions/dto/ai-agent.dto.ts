import { Type } from 'class-transformer';
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsIn,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateNested,
} from 'class-validator';
import {
	AGENT_CONVERSATION_MODES,
	AGENT_DEFAULT_MODES,
	AGENT_DIALECTS,
	AGENT_MEDIA_POLICIES,
	AGENT_REPLY_LENGTHS,
	AGENT_SCOPES,
	AGENT_TONES,
	KNOWLEDGE_CATEGORIES,
} from '../agent/ai-agent.entities';
import type {
	AgentConversationMode,
	AgentDefaultMode,
	AgentDialect,
	AgentMediaPolicy,
	AgentReplyLength,
	AgentScope,
	AgentTone,
	KnowledgeCategory,
} from '../agent/ai-agent.entities';
import { AI_REPLY_PROVIDERS, AiReplyProviderName } from '../entities/whatsapp-ai-settings.entity';

export class AgentPermissionsDto {
	@IsOptional()
	@IsBoolean()
	quotePrices?: boolean;

	@IsOptional()
	@IsBoolean()
	makeCommitments?: boolean;

	@IsOptional()
	@IsBoolean()
	offerDiscounts?: boolean;

	@IsOptional()
	@IsBoolean()
	shareLinks?: boolean;
}

export class UpdateAiAgentSettingsDto {
	@IsOptional()
	@IsBoolean()
	enabled?: boolean;

	@IsOptional()
	@IsIn(AGENT_SCOPES)
	scope?: AgentScope;

	@IsOptional()
	@IsIn(AGENT_DEFAULT_MODES)
	defaultMode?: AgentDefaultMode;

	@IsOptional()
	@IsIn(AI_REPLY_PROVIDERS)
	provider?: AiReplyProviderName;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	model?: string;

	@IsOptional()
	@IsString()
	@MaxLength(80)
	agentName?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(120)
	businessName?: string | null;

	@IsOptional()
	@IsString()
	@MaxLength(2000)
	persona?: string | null;

	@IsOptional()
	@IsIn(AGENT_DIALECTS)
	dialect?: AgentDialect;

	@IsOptional()
	@IsIn(AGENT_TONES)
	tone?: AgentTone;

	@IsOptional()
	@IsIn(AGENT_REPLY_LENGTHS)
	replyLength?: AgentReplyLength;

	@IsOptional()
	@IsString()
	@MaxLength(4000)
	rules?: string | null;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(80, { each: true })
	allowedTopics?: string[];

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(80, { each: true })
	forbiddenTopics?: string[];

	@IsOptional()
	@ValidateNested()
	@Type(() => AgentPermissionsDto)
	permissions?: AgentPermissionsDto;

	@IsOptional()
	@IsBoolean()
	useKnowledgeBase?: boolean;

	@IsOptional()
	@IsBoolean()
	knowledgeOnly?: boolean;

	@IsOptional()
	@IsBoolean()
	useContactMemory?: boolean;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(4)
	@Max(40)
	contextMessageLimit?: number;

	@IsOptional()
	@IsBoolean()
	discloseAi?: boolean;

	@IsOptional()
	@IsString()
	@MaxLength(300)
	disclosureText?: string | null;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(30)
	@IsString({ each: true })
	@MaxLength(60, { each: true })
	handoffKeywords?: string[];

	@IsOptional()
	@IsString()
	@MaxLength(500)
	handoffMessage?: string | null;

	@IsOptional()
	@IsIn(AGENT_MEDIA_POLICIES)
	mediaPolicy?: AgentMediaPolicy;

	@IsOptional()
	@IsBoolean()
	allowGroups?: boolean;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(2)
	@Max(120)
	debounceSeconds?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(1440)
	humanPauseMinutes?: number;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(120)
	maxRepliesPerHour?: number;

	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@Max(1)
	minConfidence?: number;
}

export class UpsertKnowledgeEntryDto {
	@IsOptional()
	@IsIn(KNOWLEDGE_CATEGORIES)
	category?: KnowledgeCategory;

	@IsString()
	@MinLength(1)
	@MaxLength(200)
	title: string;

	@IsString()
	@MinLength(1)
	@MaxLength(8000)
	content: string;

	@IsOptional()
	@IsArray()
	@ArrayMaxSize(20)
	@IsString({ each: true })
	@MaxLength(40, { each: true })
	tags?: string[];

	@IsOptional()
	@IsBoolean()
	isActive?: boolean;
}

export class SetConversationAgentModeDto {
	@IsIn(AGENT_CONVERSATION_MODES)
	mode: AgentConversationMode;
}

export class SendAgentSuggestionDto {
	@IsOptional()
	@IsString()
	@MaxLength(4000)
	text?: string;
}

export class AgentTestMessageDto {
	@IsIn(['customer', 'agent'])
	role: 'customer' | 'agent';

	@IsString()
	@MinLength(1)
	@MaxLength(2000)
	content: string;
}

export class AgentTestDto {
	@IsArray()
	@ArrayMaxSize(30)
	@ValidateNested({ each: true })
	@Type(() => AgentTestMessageDto)
	messages: AgentTestMessageDto[];

	/** Optional unsaved settings to try before saving them. */
	@IsOptional()
	@ValidateNested()
	@Type(() => UpdateAiAgentSettingsDto)
	draft?: UpdateAiAgentSettingsDto;
}
