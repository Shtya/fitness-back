import {
	BadRequestException,
	ConflictException,
	HttpException,
	HttpStatus,
	Injectable,
	NotFoundException,
	Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import { WhatsAppConversation } from '../../whatsapp/entities/whatsapp.entity';
import { WhatsAppAccessService } from '../../whatsapp/services/whatsapp-access.service';
import { WhatsAppAuditService } from '../../whatsapp/services/whatsapp-audit.service';
import { WhatsAppSyncService } from '../../whatsapp/services/whatsapp-sync.service';
import {
	AgentTestDto,
	SendAgentSuggestionDto,
	SetConversationAgentModeDto,
	UpdateAiAgentSettingsDto,
	UpsertKnowledgeEntryDto,
} from '../dto/ai-agent.dto';
import {
	WhatsAppAiAgentConversation,
	WhatsAppAiAgentRun,
	WhatsAppAiAgentSettings,
	WhatsAppAiContactMemory,
	WhatsAppAiKnowledgeEntry,
} from './ai-agent.entities';
import { resolvePermissions } from './ai-agent.policy';
import {
	AiAgentRuntimeService,
	EffectiveAgentSettings,
	mergeAgentSettings,
	serializeAgentState,
} from './ai-agent-runtime.service';
import { AiAgentSchemaService } from './ai-agent-schema.service';

const MAX_KNOWLEDGE_PER_ACCOUNT = 1_000;
const TEST_RATE_LIMIT_PER_MINUTE = 12;

function cleanList(values: string[] | undefined) {
	if (!Array.isArray(values)) return undefined;
	return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function cleanText(value: string | null | undefined) {
	if (value === undefined) return undefined;
	const text = String(value ?? '').trim();
	return text || null;
}

export function serializeAgentSettings(settings: EffectiveAgentSettings) {
	const { actorUserId, updatedBy, ...rest } = settings;
	return {
		...rest,
		permissions: resolvePermissions(settings.permissions),
		actorConfigured: Boolean(actorUserId),
		configured: Boolean(settings.updated_at),
	};
}

function serializeKnowledge(row: WhatsAppAiKnowledgeEntry) {
	return {
		id: row.id,
		category: row.category,
		title: row.title,
		content: row.content,
		tags: Array.isArray(row.tags) ? row.tags : [],
		isActive: row.isActive,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

@Injectable()
export class AiAgentService {
	private readonly testBuckets = new Map<string, number[]>();

	constructor(
		@InjectRepository(WhatsAppAiAgentSettings)
		private readonly settingsRepo: Repository<WhatsAppAiAgentSettings>,
		@InjectRepository(WhatsAppAiAgentConversation)
		private readonly stateRepo: Repository<WhatsAppAiAgentConversation>,
		@InjectRepository(WhatsAppAiKnowledgeEntry)
		private readonly knowledgeRepo: Repository<WhatsAppAiKnowledgeEntry>,
		@InjectRepository(WhatsAppAiContactMemory)
		private readonly memoryRepo: Repository<WhatsAppAiContactMemory>,
		@InjectRepository(WhatsAppAiAgentRun)
		private readonly runRepo: Repository<WhatsAppAiAgentRun>,
		@InjectRepository(WhatsAppConversation)
		private readonly conversationRepo: Repository<WhatsAppConversation>,
		private readonly access: WhatsAppAccessService,
		private readonly sync: WhatsAppSyncService,
		private readonly runtime: AiAgentRuntimeService,
		@Optional() private readonly audit?: WhatsAppAuditService,
		@Optional() private readonly schema?: AiAgentSchemaService,
	) {}

	/* ------------------------------------------------------------ settings */

	async getSettings(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		return serializeAgentSettings(await this.runtime.getSettings(accountId, { fresh: true }));
	}

	async updateSettings(user: User, accountId: string, dto: UpdateAiAgentSettingsDto) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		await this.schema?.ensure();
		const current = await this.settingsRepo.findOne({ where: { accountId } });
		const patch = this.settingsPatch(dto);
		const merged = mergeAgentSettings(accountId, { ...(current || {}), ...patch });
		const row = this.settingsRepo.create({
			...merged,
			created_at: current?.created_at,
			updated_at: undefined,
			accountId,
			// Autonomous replies go out as the manager who last configured the agent,
			// so sends keep normal WhatsApp permission checks and audit attribution.
			actorUserId: user.id,
			updatedBy: user.id,
			lastError: dto.enabled === true ? null : merged.lastError,
		} as any);
		await this.settingsRepo.save(row);
		this.runtime.invalidateSettings(accountId);
		await this.audit
			?.write({
				actorUserId: user.id,
				accountId,
				action: 'whatsapp.ai_agent.settings_updated',
				targetType: 'WhatsAppAccount',
				targetId: accountId,
				metadata: { fields: Object.keys(patch), enabled: merged.enabled, scope: merged.scope },
			})
			.catch(() => undefined);
		return serializeAgentSettings(await this.runtime.getSettings(accountId, { fresh: true }));
	}

	private settingsPatch(dto: UpdateAiAgentSettingsDto): Partial<WhatsAppAiAgentSettings> {
		const patch: Record<string, unknown> = {};
		const assign = (key: string, value: unknown) => {
			if (value !== undefined) patch[key] = value;
		};
		assign('enabled', dto.enabled);
		assign('scope', dto.scope);
		assign('defaultMode', dto.defaultMode);
		assign('provider', dto.provider);
		assign('model', dto.model === undefined ? undefined : String(dto.model || '').trim() || 'auto');
		assign('agentName', cleanText(dto.agentName));
		assign('businessName', cleanText(dto.businessName));
		assign('persona', cleanText(dto.persona));
		assign('dialect', dto.dialect);
		assign('tone', dto.tone);
		assign('replyLength', dto.replyLength);
		assign('rules', cleanText(dto.rules));
		assign('allowedTopics', cleanList(dto.allowedTopics));
		assign('forbiddenTopics', cleanList(dto.forbiddenTopics));
		assign('permissions', dto.permissions ? resolvePermissions(dto.permissions) : undefined);
		assign('useKnowledgeBase', dto.useKnowledgeBase);
		assign('knowledgeOnly', dto.knowledgeOnly);
		assign('useContactMemory', dto.useContactMemory);
		assign('contextMessageLimit', dto.contextMessageLimit);
		assign('discloseAi', dto.discloseAi);
		assign('disclosureText', cleanText(dto.disclosureText));
		assign('handoffKeywords', cleanList(dto.handoffKeywords));
		assign('handoffMessage', cleanText(dto.handoffMessage));
		assign('mediaPolicy', dto.mediaPolicy);
		assign('allowGroups', dto.allowGroups);
		assign('debounceSeconds', dto.debounceSeconds);
		assign('humanPauseMinutes', dto.humanPauseMinutes);
		assign('maxRepliesPerHour', dto.maxRepliesPerHour);
		assign('minConfidence', dto.minConfidence);
		return patch as Partial<WhatsAppAiAgentSettings>;
	}

	/* ----------------------------------------------------------- knowledge */

	async listKnowledge(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		await this.schema?.ensure();
		const rows = await this.knowledgeRepo.find({
			where: { accountId },
			order: { category: 'ASC', updated_at: 'DESC' },
			take: MAX_KNOWLEDGE_PER_ACCOUNT,
		});
		return rows.map(serializeKnowledge);
	}

	async createKnowledge(user: User, accountId: string, dto: UpsertKnowledgeEntryDto) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		await this.schema?.ensure();
		const count = await this.knowledgeRepo.count({ where: { accountId } });
		if (count >= MAX_KNOWLEDGE_PER_ACCOUNT) {
			throw new BadRequestException(`Knowledge base is limited to ${MAX_KNOWLEDGE_PER_ACCOUNT} entries`);
		}
		const saved = await this.knowledgeRepo.save(
			this.knowledgeRepo.create({
				accountId,
				category: dto.category || 'faq',
				title: dto.title.trim(),
				content: dto.content.trim(),
				tags: cleanList(dto.tags) || [],
				isActive: dto.isActive ?? true,
				createdBy: user.id,
				updatedBy: user.id,
			}),
		);
		await this.auditKnowledge(user, accountId, 'created', saved.id);
		return serializeKnowledge(saved);
	}

	async updateKnowledge(user: User, accountId: string, id: string, dto: UpsertKnowledgeEntryDto) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		const row = await this.knowledgeRepo.findOne({ where: { id, accountId } });
		if (!row) throw new NotFoundException('Knowledge entry not found');
		row.category = dto.category || row.category;
		row.title = dto.title.trim();
		row.content = dto.content.trim();
		row.tags = cleanList(dto.tags) ?? row.tags;
		row.isActive = dto.isActive ?? row.isActive;
		row.updatedBy = user.id;
		const saved = await this.knowledgeRepo.save(row);
		await this.auditKnowledge(user, accountId, 'updated', id);
		return serializeKnowledge(saved);
	}

	async deleteKnowledge(user: User, accountId: string, id: string) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		const result = await this.knowledgeRepo.delete({ id, accountId });
		if (!result.affected) throw new NotFoundException('Knowledge entry not found');
		await this.auditKnowledge(user, accountId, 'deleted', id);
		return { ok: true };
	}

	private auditKnowledge(user: User, accountId: string, verb: string, id: string) {
		return (
			this.audit
				?.write({
					actorUserId: user.id,
					accountId,
					action: `whatsapp.ai_agent.knowledge_${verb}`,
					targetType: 'WhatsAppAiKnowledgeEntry',
					targetId: id,
					metadata: {},
				})
				.catch(() => undefined) ?? Promise.resolve(undefined)
		);
	}

	/* ------------------------------------------------------- conversations */

	async listConversationStates(user: User, accountId: string) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new NotFoundException('WhatsApp account not found');
		await this.schema?.ensure();
		const settings = await this.runtime.getSettings(accountId);
		let states = await this.stateRepo.find({
			where: { accountId },
			order: { updated_at: 'DESC' },
			take: 2_000,
		});
		if (!this.access.canSeeAllConversations(user, accountAccess) && states.length) {
			const assigned = await this.conversationRepo.find({
				where: { accountId, assignedUserId: user.id, id: In(states.map(state => state.conversationId)) },
				select: ['id'],
			});
			const allowed = new Set(assigned.map(row => row.id));
			states = states.filter(state => allowed.has(state.conversationId));
		}
		return {
			settings: {
				enabled: settings.enabled,
				scope: settings.scope,
				defaultMode: settings.defaultMode,
			},
			conversations: states.map(state => serializeAgentState(state, settings)),
		};
	}

	async getConversation(user: User, conversationId: string) {
		const { conversation } = await this.access.assertConversationVisible(user, conversationId);
		await this.schema?.ensure();
		return this.conversationPayload(conversation);
	}

	private async conversationPayload(conversation: WhatsAppConversation) {
		const settings = await this.runtime.getSettings(conversation.accountId);
		const [state, memory] = await Promise.all([
			this.runtime.loadState(conversation),
			this.memoryRepo.findOne({ where: { conversationId: conversation.id } }),
		]);
		return {
			settings: {
				enabled: settings.enabled,
				scope: settings.scope,
				defaultMode: settings.defaultMode,
			},
			state: serializeAgentState(state, settings),
			busy: this.runtime.isBusy(conversation.id),
			memory: {
				facts: memory?.facts || [],
				commitments: memory?.commitments || [],
			},
		};
	}

	async setConversationMode(user: User, conversationId: string, dto: SetConversationAgentModeDto) {
		const { conversation } = await this.visibleWithPermission(user, conversationId, 'canUse');
		const patch: Partial<WhatsAppAiAgentConversation> = { mode: dto.mode, updatedBy: user.id };
		if (dto.mode === 'off') {
			this.runtime.cancel(conversationId);
			Object.assign(patch, { pendingSuggestion: null, status: 'idle', statusReason: null });
		}
		await this.runtime.updateState(conversation, patch);
		await this.audit
			?.write({
				actorUserId: user.id,
				accountId: conversation.accountId,
				action: 'whatsapp.ai_agent.mode_changed',
				targetType: 'WhatsAppConversation',
				targetId: conversationId,
				metadata: { mode: dto.mode },
			})
			.catch(() => undefined);
		return this.conversationPayload(conversation);
	}

	async resume(user: User, conversationId: string) {
		const { conversation } = await this.visibleWithPermission(user, conversationId, 'canUse');
		await this.runtime.updateState(conversation, {
			pausedUntil: null,
			status: 'idle',
			statusReason: null,
			lastError: null,
			updatedBy: user.id,
		});
		const settings = await this.runtime.getSettings(conversation.accountId, { fresh: true });
		if (settings.enabled) this.runtime.schedule(conversation.accountId, conversationId, 1_000);
		return this.conversationPayload(conversation);
	}

	async sendSuggestion(user: User, conversationId: string, dto: SendAgentSuggestionDto) {
		const { conversation } = await this.visibleWithPermission(user, conversationId, 'canUse');
		const state = await this.runtime.loadState(conversation);
		const suggestion = state.pendingSuggestion;
		if (!suggestion) throw new ConflictException('There is no pending AI suggestion');
		const text = String(dto.text ?? suggestion.text ?? '').trim();
		if (!text) throw new BadRequestException('Reply text is empty');
		const result: any = await this.sync.sendText(
			user,
			conversationId,
			text,
			undefined,
			`ai-agent-${suggestion.runId}-approved`,
		);
		const messageId = String(result?.message?.id || '') || null;
		if (messageId) this.runtime.rememberOwnMessage(messageId);
		await this.runRepo
			.update(suggestion.runId, {
				outcome: 'approved',
				replyMessageId: messageId,
				reply: text,
			})
			.catch(() => undefined);
		await this.runtime.updateState(conversation, {
			pendingSuggestion: null,
			status: 'replied',
			statusReason: text === suggestion.text ? null : 'edited',
			lastReplyAt: new Date(),
			updatedBy: user.id,
		});
		await this.audit
			?.write({
				actorUserId: user.id,
				accountId: conversation.accountId,
				action: 'whatsapp.ai_agent.suggestion_sent',
				targetType: 'WhatsAppMessage',
				targetId: messageId,
				metadata: { conversationId, runId: suggestion.runId, edited: text !== suggestion.text },
			})
			.catch(() => undefined);
		return { ok: true, message: result?.message ?? null, agent: await this.conversationPayload(conversation) };
	}

	async dismissSuggestion(user: User, conversationId: string) {
		const { conversation } = await this.visibleWithPermission(user, conversationId, 'canUse');
		const state = await this.runtime.loadState(conversation);
		if (state.pendingSuggestion?.runId) {
			await this.runRepo
				.update(state.pendingSuggestion.runId, { outcome: 'dismissed' })
				.catch(() => undefined);
		}
		await this.runtime.updateState(conversation, {
			pendingSuggestion: null,
			status: 'idle',
			statusReason: 'dismissed',
			updatedBy: user.id,
		});
		return this.conversationPayload(conversation);
	}

	async clearMemory(user: User, conversationId: string) {
		const { conversation } = await this.visibleWithPermission(user, conversationId, 'canUse');
		await this.memoryRepo.delete({ conversationId });
		await this.audit
			?.write({
				actorUserId: user.id,
				accountId: conversation.accountId,
				action: 'whatsapp.ai_agent.memory_cleared',
				targetType: 'WhatsAppConversation',
				targetId: conversationId,
				metadata: {},
			})
			.catch(() => undefined);
		return this.conversationPayload(conversation);
	}

	private async visibleWithPermission(
		user: User,
		conversationId: string,
		permission: 'canUse' | 'canManage',
	) {
		const visible = await this.access.assertConversationVisible(user, conversationId);
		if (!visible.accountAccess?.[permission]) {
			throw new HttpException(`WhatsApp account permission denied: ${permission}`, HttpStatus.FORBIDDEN);
		}
		await this.schema?.ensure();
		return visible;
	}

	/* ---------------------------------------------------------------- runs */

	async listRuns(user: User, accountId: string, limit = 50) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		await this.schema?.ensure();
		const rows = await this.runRepo.find({
			where: { accountId },
			order: { created_at: 'DESC' },
			take: Math.min(Math.max(Number(limit) || 50, 1), 200),
		});
		return rows.map(row => ({
			id: row.id,
			conversationId: row.conversationId,
			outcome: row.outcome,
			reasons: row.reasons || [],
			reply: row.reply,
			sources: row.sources || [],
			provider: row.provider,
			model: row.model,
			latencyMs: row.latencyMs,
			error: row.error,
			createdAt: row.created_at,
		}));
	}

	/* ---------------------------------------------------------------- test */

	async test(user: User, accountId: string, dto: AgentTestDto) {
		await this.access.assertAccountPermission(user, accountId, 'canManage');
		this.assertTestRate(user.id);
		const stored = await this.runtime.getSettings(accountId, { fresh: true });
		const settings = dto.draft
			? mergeAgentSettings(accountId, { ...stored, ...this.settingsPatch(dto.draft) } as any)
			: stored;
		const messages = (dto.messages || [])
			.map(item => ({ role: item.role, content: String(item.content || '').trim() }))
			.filter(item => item.content);
		if (!messages.length || messages[messages.length - 1].role !== 'customer') {
			throw new BadRequestException('The last test message must come from the customer');
		}
		let trailingStart = messages.length - 1;
		while (trailingStart > 0 && messages[trailingStart - 1].role === 'customer') trailingStart -= 1;
		const query = messages
			.slice(trailingStart)
			.map(item => item.content)
			.join('\n');
		const agentReplies = messages.filter(item => item.role === 'agent').map(item => item.content);
		const generated = await this.runtime.generate({
			settings,
			recent: messages.slice(-settings.contextMessageLimit),
			relevantHistory: [],
			knowledgeDocs: settings.useKnowledgeBase ? await this.runtime.knowledgeDocs(accountId) : [],
			memory: null,
			isFirstAgentReply: agentReplies.length === 0,
			mediaNote: null,
			query,
			previousAgentReplies: agentReplies.slice(-5),
		});
		const mode = settings.defaultMode;
		const delivery =
			generated.decision === 'send'
				? mode === 'auto'
					? 'would_send'
					: 'would_suggest'
				: generated.decision === 'suggest'
					? 'would_suggest'
					: generated.decision === 'handoff'
						? 'would_handoff'
						: 'would_skip';
		return {
			reply: generated.result.reply,
			decision: generated.decision,
			delivery,
			reasons: generated.reasons,
			confidence: generated.result.confidence,
			reasoning: generated.result.reasoning,
			memory: generated.result.memory,
			sources: generated.sources,
			provider: generated.provider,
			model: generated.actualModel || generated.model,
			latencyMs: generated.latencyMs,
		};
	}

	private assertTestRate(userId: string) {
		const now = Date.now();
		const bucket = (this.testBuckets.get(userId) || []).filter(at => now - at < 60_000);
		if (bucket.length >= TEST_RATE_LIMIT_PER_MINUTE) {
			throw new HttpException('Too many test requests, try again in a minute', HttpStatus.TOO_MANY_REQUESTS);
		}
		bucket.push(now);
		this.testBuckets.set(userId, bucket);
	}
}
