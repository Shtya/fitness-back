import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Not, Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppConversation,
	WhatsAppConversationType,
	WhatsAppMessage,
	WhatsAppMessageDirection,
} from '../../whatsapp/entities/whatsapp.entity';
import { WhatsAppGateway } from '../../whatsapp/gateways/whatsapp.gateway';
import { WhatsAppAuditService } from '../../whatsapp/services/whatsapp-audit.service';
import { WhatsAppSyncService } from '../../whatsapp/services/whatsapp-sync.service';
import { AiReplyProviderRegistry } from '../providers/ai-reply-provider.registry';
import {
	AgentEffectiveMode,
	AgentMemoryItem,
	AgentPendingSuggestion,
	AgentSourceRef,
	AgentStatus,
	WhatsAppAiAgentConversation,
	WhatsAppAiAgentRun,
	WhatsAppAiAgentSettings,
	WhatsAppAiContactMemory,
	WhatsAppAiExternalModel,
	WhatsAppAiKnowledgeEntry,
} from './ai-agent.entities';
import {
	decryptAgentSecret,
	generateOpenAiCompatible,
	providerFallbackChain,
} from './ai-agent-models';
import {
	AgentContextMessage,
	AgentModelResult,
	AgentPromptSettings,
	applyGuards,
	buildAgentPrompt,
	debounceDeadline,
	describeMedia,
	detectHandoffRequest,
	GuardDecision,
	KnowledgeDoc,
	MEDIA_TYPES,
	mergeMemory,
	normalizeForSearch,
	parseAgentResult,
	rankRelevantHistory,
	resolveEffectiveMode,
	resolvePermissions,
	retrieveKnowledge,
	sourcesFor,
} from './ai-agent.policy';
import { AiAgentSchemaService } from './ai-agent-schema.service';

export const AGENT_STATE_EVENT = 'ai_agent.state';
const PROVIDER_TIMEOUT_MS = 45_000;
const HANDOFF_PAUSE_MS = 24 * 60 * 60_000;
const SETTINGS_CACHE_MS = 15_000;
const MAX_KNOWLEDGE_ENTRIES = 500;
/** Never answer a message this old (e.g. after resuming a long-paused chat). */
const MAX_TRIGGER_AGE_MS = 6 * 60 * 60_000;

/** Effective agent configuration: stored row merged over defaults. */
export type EffectiveAgentSettings = Omit<WhatsAppAiAgentSettings, 'created_at' | 'updated_at'> & {
	created_at: Date | null;
	updated_at: Date | null;
};

export function defaultAgentSettings(accountId: string): EffectiveAgentSettings {
	return {
		accountId,
		created_at: null,
		updated_at: null,
		enabled: false,
		scope: 'selected',
		defaultMode: 'suggest',
		provider: 'ai-free',
		model: 'auto',
		externalModelId: null,
		agentName: null,
		businessName: null,
		persona: null,
		dialect: 'auto',
		tone: 'professional',
		replyLength: 'short',
		rules: null,
		allowedTopics: [],
		forbiddenTopics: [],
		permissions: {},
		useKnowledgeBase: true,
		knowledgeOnly: true,
		useContactMemory: true,
		contextMessageLimit: 12,
		discloseAi: true,
		disclosureText: null,
		handoffKeywords: [],
		handoffMessage: null,
		mediaPolicy: 'handoff',
		allowGroups: false,
		debounceSeconds: 8,
		humanPauseMinutes: 30,
		maxRepliesPerHour: 12,
		minConfidence: 0.55,
		actorUserId: null,
		updatedBy: null,
		lastError: null,
	};
}

export function mergeAgentSettings(
	accountId: string,
	row: Partial<WhatsAppAiAgentSettings> | null | undefined,
): EffectiveAgentSettings {
	const base = defaultAgentSettings(accountId);
	if (!row) return base;
	const merged = { ...base } as EffectiveAgentSettings;
	for (const [key, value] of Object.entries(row)) {
		if (value !== undefined) (merged as any)[key] = value;
	}
	merged.accountId = accountId;
	merged.allowedTopics = Array.isArray(merged.allowedTopics) ? merged.allowedTopics : [];
	merged.forbiddenTopics = Array.isArray(merged.forbiddenTopics) ? merged.forbiddenTopics : [];
	merged.handoffKeywords = Array.isArray(merged.handoffKeywords) ? merged.handoffKeywords : [];
	merged.minConfidence = Number(merged.minConfidence);
	if (!Number.isFinite(merged.minConfidence)) merged.minConfidence = base.minConfidence;
	return merged;
}

function promptSettings(settings: EffectiveAgentSettings): AgentPromptSettings {
	return {
		agentName: settings.agentName,
		businessName: settings.businessName,
		persona: settings.persona,
		dialect: settings.dialect,
		tone: settings.tone,
		replyLength: settings.replyLength,
		rules: settings.rules,
		allowedTopics: settings.allowedTopics,
		forbiddenTopics: settings.forbiddenTopics,
		permissions: resolvePermissions(settings.permissions),
		useKnowledgeBase: settings.useKnowledgeBase,
		knowledgeOnly: settings.useKnowledgeBase && settings.knowledgeOnly,
		discloseAi: settings.discloseAi,
		disclosureText: settings.disclosureText,
	};
}

const PLACEHOLDERS: Record<string, string> = {
	image: '[image]',
	photo: '[image]',
	video: '[video]',
	audio: '[voice message]',
	ptt: '[voice message]',
	voice: '[voice message]',
	document: '[file]',
	sticker: '[sticker]',
	location: '[location]',
	contact: '[contact card]',
	poll: '[poll]',
};

export function agentMessageContent(message: Pick<WhatsAppMessage, 'type' | 'text'>) {
	const type = String(message.type || 'text').toLowerCase();
	const text = String(message.text || '')
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 2_000);
	if (type === 'text' || type === 'chat') return text;
	const placeholder = PLACEHOLDERS[type] || '[attachment]';
	return text ? `${placeholder} ${text}` : placeholder;
}

function hasArabic(text: string) {
	return /[\u0600-\u06FF]/.test(text);
}

function defaultHandoffMessage(sample: string) {
	return hasArabic(sample)
		? 'شكرًا لتواصلك، سيتابع معك أحد أعضاء الفريق قريبًا.'
		: 'Thanks for reaching out. A member of our team will follow up with you shortly.';
}

function errorText(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function shouldRetrySameProvider(error: unknown) {
	const message = errorText(error);
	if (/\b429\b|rate.?limit|too many requests/i.test(message)) return false;
	if (/\b(401|403|404)\b/.test(message)) return false;
	return /timed out|timeout|ECONNRESET|503|502|network|fetch failed/i.test(message);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: NodeJS.Timeout | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error('AI provider timed out')), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export interface AgentGenerationInput {
	settings: EffectiveAgentSettings;
	recent: AgentContextMessage[];
	relevantHistory: AgentContextMessage[];
	knowledgeDocs: KnowledgeDoc[];
	memory: { facts: AgentMemoryItem[]; commitments: AgentMemoryItem[] } | null;
	isFirstAgentReply: boolean;
	mediaNote: string | null;
	query: string;
	previousAgentReplies: string[];
}

export interface ProviderFailure {
	provider: string;
	error: string;
}

export interface ProviderAlert {
	provider: string;
	error: string;
	at: string;
	recoveredBy: string | null;
}

export interface AgentGenerationOutput {
	result: AgentModelResult;
	decision: GuardDecision;
	reasons: string[];
	sources: AgentSourceRef[];
	provider: string;
	model: string;
	actualModel: string | null;
	latencyMs: number;
	fallbacks: ProviderFailure[];
}

interface PendingBurst {
	accountId: string;
	firstAt: number;
	timer: NodeJS.Timeout;
}

/**
 * Autonomous agent pipeline: listens to live inbound messages, debounces bursts per
 * conversation, holds one in-flight run per conversation, claims each trigger in the
 * database (so restarts / multiple instances never answer twice), and only sends
 * replies that pass the deterministic guards. Everything else becomes a draft or a
 * hand-off to a human.
 */
@Injectable()
export class AiAgentRuntimeService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(AiAgentRuntimeService.name);
	private readonly pending = new Map<string, PendingBurst>();
	private readonly running = new Map<string, Promise<void>>();
	private readonly rerun = new Set<string>();
	private readonly settingsCache = new Map<string, { value: EffectiveAgentSettings; at: number }>();
	/** Message ids the agent itself just sent (outbound echo must not pause the agent). */
	private readonly ownMessageIds = new Map<string, number>();
	/** Last provider failures for the Models tab / test-chat banner (per account). */
	private readonly providerAlerts = new Map<string, ProviderAlert[]>();
	private unsubscribers: Array<() => void> = [];

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
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly sync: WhatsAppSyncService,
		private readonly gateway: WhatsAppGateway,
		private readonly providers: AiReplyProviderRegistry,
		@Optional() private readonly audit?: WhatsAppAuditService,
		@Optional() private readonly schema?: AiAgentSchemaService,
		@Optional() @InjectRepository(WhatsAppAiExternalModel)
		private readonly externalRepo?: Repository<WhatsAppAiExternalModel>,
		@Optional() private readonly config?: ConfigService,
	) {}

	onModuleInit() {
		this.unsubscribers.push(
			this.sync.onInboundMessagePersisted((accountId, message) =>
				this.handleInbound(accountId, message),
			),
			this.sync.onOutboundMessagePersisted((accountId, message) =>
				this.handleOutbound(accountId, message),
			),
		);
	}

	onModuleDestroy() {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.unsubscribers = [];
		for (const burst of this.pending.values()) clearTimeout(burst.timer);
		this.pending.clear();
	}

	/* ------------------------------------------------------------ settings */

	async getSettings(accountId: string, options: { fresh?: boolean } = {}) {
		const cached = this.settingsCache.get(accountId);
		if (!options.fresh && cached && Date.now() - cached.at < SETTINGS_CACHE_MS) return cached.value;
		await this.schema?.ensure();
		const row = await this.settingsRepo.findOne({ where: { accountId } });
		const value = mergeAgentSettings(accountId, row);
		this.settingsCache.set(accountId, { value, at: Date.now() });
		return value;
	}

	invalidateSettings(accountId: string) {
		this.settingsCache.delete(accountId);
	}

	async loadState(conversation: Pick<WhatsAppConversation, 'id' | 'accountId'>) {
		const existing = await this.stateRepo.findOne({ where: { conversationId: conversation.id } });
		if (existing) return existing;
		return this.stateRepo.create({
			conversationId: conversation.id,
			accountId: conversation.accountId,
			mode: 'inherit',
			status: 'idle',
			statusReason: null,
			pausedUntil: null,
			lastReplyAt: null,
			lastError: null,
			pendingSuggestion: null,
			updatedBy: null,
		});
	}

	/* -------------------------------------------------------------- events */

	async handleInbound(accountId: string, message: WhatsAppMessage) {
		if (!message?.conversationId || message.direction !== WhatsAppMessageDirection.INBOUND) return;
		const settings = await this.getSettings(accountId).catch(() => null);
		if (!settings?.enabled) return;
		const state = await this.stateRepo
			.findOne({ where: { conversationId: message.conversationId } })
			.catch(() => null);
		if (resolveEffectiveMode(settings, state?.mode) === 'off') return;
		this.schedule(accountId, message.conversationId, settings.debounceSeconds * 1_000);
	}

	async handleOutbound(accountId: string, message: WhatsAppMessage) {
		if (!message?.conversationId) return;
		if (this.ownMessageIds.has(message.id)) return;
		const settings = await this.getSettings(accountId).catch(() => null);
		if (!settings?.enabled) return;
		const state = await this.stateRepo
			.findOne({ where: { conversationId: message.conversationId } })
			.catch(() => null);
		if (resolveEffectiveMode(settings, state?.mode) === 'off') return;
		if (await this.isRecentAgentEcho(message)) return;
		// A human answered from the phone: stop any queued reply and step back.
		this.cancel(message.conversationId);
		const conversation = await this.conversationRepo.findOne({
			where: { id: message.conversationId },
			select: ['id', 'accountId', 'assignedUserId', 'providerChatId'],
		});
		if (!conversation) return;
		await this.updateState(conversation, {
			status: 'paused',
			statusReason: 'human_replied',
			pausedUntil: new Date(Date.now() + settings.humanPauseMinutes * 60_000),
		});
	}

	/** Push the reply out by the debounce window (bounded by the max wait). */
	schedule(accountId: string, conversationId: string, debounceMs: number) {
		const now = Date.now();
		const existing = this.pending.get(conversationId);
		if (existing) clearTimeout(existing.timer);
		const firstAt = existing?.firstAt ?? now;
		const deadline = debounceDeadline({ now, firstPendingAt: firstAt, debounceMs });
		const timer = setTimeout(() => this.fire(conversationId), Math.max(0, deadline - now));
		timer.unref?.();
		this.pending.set(conversationId, { accountId, firstAt, timer });
		if (!existing) void this.emitTransient(accountId, conversationId, 'waiting');
	}

	cancel(conversationId: string) {
		const existing = this.pending.get(conversationId);
		if (existing) clearTimeout(existing.timer);
		this.pending.delete(conversationId);
	}

	/** One run per conversation; a trigger during a run re-runs once afterwards. */
	fire(conversationId: string) {
		this.pending.delete(conversationId);
		if (this.running.has(conversationId)) {
			this.rerun.add(conversationId);
			return this.running.get(conversationId)!;
		}
		const run = this.process(conversationId)
			.catch(error =>
				this.logger.warn(
					`AI agent run failed for ${conversationId}: ${error instanceof Error ? error.message : error}`,
				),
			)
			.finally(() => {
				this.running.delete(conversationId);
				if (this.rerun.delete(conversationId)) void this.fire(conversationId);
				else if (!this.pending.has(conversationId)) void this.emitSettled(conversationId);
			});
		this.running.set(conversationId, run);
		return run;
	}

	isBusy(conversationId: string) {
		return this.pending.has(conversationId) || this.running.has(conversationId);
	}

	/* ------------------------------------------------------------ pipeline */

	async process(conversationId: string) {
		const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!conversation || conversation.isClosed) return;
		const settings = await this.getSettings(conversation.accountId, { fresh: true });
		if (!settings.enabled) return;
		if (conversation.type === WhatsAppConversationType.GROUP && !settings.allowGroups) return;
		const state = await this.loadState(conversation);
		const mode = resolveEffectiveMode(settings, state.mode);
		if (mode === 'off') return;
		const now = Date.now();
		if (state.pausedUntil && new Date(state.pausedUntil).getTime() > now) return;

		const window = await this.recentMessages(conversationId, settings.contextMessageLimit);
		const lastOutboundIndex = findLastIndex(window, row => row.direction === WhatsAppMessageDirection.OUTBOUND);
		const burst = window
			.slice(lastOutboundIndex + 1)
			.filter(row => row.direction === WhatsAppMessageDirection.INBOUND);
		if (!burst.length) return;
		const trigger = burst[burst.length - 1];
		if (now - new Date(trigger.providerTimestamp).getTime() > MAX_TRIGGER_AGE_MS) return;

		const lastOutbound = lastOutboundIndex >= 0 ? window[lastOutboundIndex] : null;
		if (lastOutbound && !(await this.isAgentMessage(lastOutbound.id))) {
			const pauseUntil =
				new Date(lastOutbound.providerTimestamp).getTime() + settings.humanPauseMinutes * 60_000;
			if (pauseUntil > now) {
				await this.updateState(conversation, {
					status: 'paused',
					statusReason: 'human_active',
					pausedUntil: new Date(pauseUntil),
				});
				return;
			}
		}

		const runId = await this.claimRun(conversation, trigger.id);
		if (!runId) return;
		const startedAt = Date.now();
		const finish = (patch: Partial<WhatsAppAiAgentRun>) =>
			this.runRepo.update(runId, { latencyMs: Date.now() - startedAt, ...patch } as any);

		try {
			const sentLastHour = await this.runRepo.count({
				where: {
					conversationId,
					outcome: In(['sent', 'approved']),
					created_at: MoreThan(new Date(now - 60 * 60_000)),
				},
			});
			if (sentLastHour >= settings.maxRepliesPerHour) {
				await finish({ outcome: 'skipped', reasons: ['rate_limited'] });
				await this.updateState(conversation, {
					status: 'paused',
					statusReason: 'rate_limited',
					pausedUntil: new Date(now + 60 * 60_000),
				});
				return;
			}

			const burstText = burst.map(row => agentMessageContent(row)).join('\n');
			const previousAgentReplies = await this.previousAgentReplies(conversationId);
			if (
				previousAgentReplies.some(
					reply => normalizeForSearch(reply) === normalizeForSearch(trigger.text || ''),
				)
			) {
				await finish({ outcome: 'skipped', reasons: ['echo_loop'] });
				await this.updateState(conversation, { status: 'idle', statusReason: 'echo_loop' });
				return;
			}

			if (detectHandoffRequest(burstText, settings.handoffKeywords)) {
				await this.handoff(conversation, settings, mode, runId, finish, burstText, ['customer_requested_human']);
				return;
			}

			const textual = burst.filter(row => !MEDIA_TYPES.has(String(row.type || '').toLowerCase()) || String(row.text || '').trim());
			const mediaOnly = burst.filter(row => !textual.includes(row));
			let mediaNote: string | null = null;
			if (mediaOnly.length) {
				if (settings.mediaPolicy === 'handoff') {
					await this.handoff(conversation, settings, mode, runId, finish, burstText, ['media_message']);
					return;
				}
				if (settings.mediaPolicy === 'ignore' && !textual.length) {
					await finish({ outcome: 'skipped', reasons: ['media_ignored'] });
					await this.updateState(conversation, { status: 'idle', statusReason: 'media_ignored' });
					return;
				}
				if (settings.mediaPolicy === 'acknowledge') {
					const kinds = [...new Set(mediaOnly.map(row => describeMedia(row.type)))].join(', ');
					mediaNote = `The customer sent a ${kinds} that you cannot see or hear. Acknowledge it briefly, do not guess its content, and ask them to type the key details or offer a team member.`;
				}
			}

			await this.updateState(conversation, { status: 'generating', statusReason: null });
			const [knowledgeDocs, memory, history, firstReply] = await Promise.all([
				settings.useKnowledgeBase ? this.knowledgeDocs(conversation.accountId) : Promise.resolve([]),
				settings.useContactMemory
					? this.memoryRepo.findOne({ where: { conversationId } })
					: Promise.resolve(null),
				this.relevantHistory(conversationId, window[0], burstText),
				this.runRepo
					.count({ where: { conversationId, outcome: In(['sent', 'approved']) } })
					.then(count => count === 0),
			]);
			const generated = await this.generate({
				settings,
				recent: window.map(row => ({
					role: row.direction === WhatsAppMessageDirection.OUTBOUND ? 'agent' : 'customer',
					content: agentMessageContent(row),
					at: new Date(row.providerTimestamp).toISOString(),
				})),
				relevantHistory: history,
				knowledgeDocs,
				memory: memory ? { facts: memory.facts || [], commitments: memory.commitments || [] } : null,
				isFirstAgentReply: firstReply,
				mediaNote,
				query: burstText,
				previousAgentReplies,
			});

			// Anything newer than the trigger means this answer may be stale.
			const latest = await this.messageRepo.findOne({
				where: { conversationId, deletedMode: 'none' },
				order: { providerTimestamp: 'DESC', id: 'DESC' },
				select: ['id', 'direction', 'senderUserId', 'providerTimestamp'],
			});
			if (latest && latest.id !== trigger.id) {
				const humanReplied = latest.direction === WhatsAppMessageDirection.OUTBOUND;
				await finish({
					outcome: 'superseded',
					reasons: [humanReplied ? 'human_replied_during_generation' : 'newer_message'],
					reply: generated.result.reply || null,
					provider: generated.provider,
					model: generated.actualModel || generated.model,
				});
				// A newer customer message already scheduled its own debounced run.
				if (humanReplied) {
					await this.updateState(conversation, {
						status: 'paused',
						statusReason: 'human_replied',
						pausedUntil: new Date(Date.now() + settings.humanPauseMinutes * 60_000),
					});
				}
				return;
			}

			const base = {
				reasons: generated.reasons,
				reply: generated.result.reply || null,
				sources: generated.sources,
				provider: generated.provider,
				model: generated.actualModel || generated.model,
			};
			if (generated.decision === 'skip') {
				await finish({ outcome: 'skipped', ...base });
				await this.updateState(conversation, { status: 'idle', statusReason: generated.reasons[0] || null });
				return;
			}
			if (generated.decision === 'handoff') {
				const clean = generated.reasons.every(reason => reason === 'model_handoff');
				await this.handoff(
					conversation,
					settings,
					mode,
					runId,
					patch => finish({ ...base, ...patch }),
					burstText,
					generated.reasons,
					clean ? generated.result.reply : null,
				);
				return;
			}
			if (generated.decision === 'suggest' || mode === 'suggest') {
				await this.suggest(conversation, runId, trigger.id, generated, finish);
				await this.rememberFacts(conversation, settings, generated.result, false);
				return;
			}

			const sent = await this.sendAsAgent(conversation, settings, runId, generated.result.reply);
			if (!sent.ok) {
				await this.suggest(
					conversation,
					runId,
					trigger.id,
					{ ...generated, reasons: [...generated.reasons, sent.reason] },
					finish,
				);
				return;
			}
			await finish({ outcome: 'sent', replyMessageId: sent.messageId, ...base });
			await this.rememberFacts(conversation, settings, generated.result, true);
			await this.updateState(conversation, {
				status: 'replied',
				statusReason: null,
				lastReplyAt: new Date(),
				lastError: null,
				pendingSuggestion: null,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await finish({ outcome: 'error', error: message.slice(0, 500) }).catch(() => undefined);
			await this.updateState(conversation, {
				status: 'error',
				statusReason: 'provider_failed',
				lastError: message.slice(0, 500),
			}).catch(() => undefined);
			await this.settingsRepo
				.update({ accountId: conversation.accountId }, { lastError: message.slice(0, 500) })
				.catch(() => undefined);
		}
	}

	getProviderAlerts(accountId: string): ProviderAlert[] {
		const cutoff = Date.now() - 30 * 60_000;
		const live = (this.providerAlerts.get(accountId) || []).filter(item => Date.parse(item.at) >= cutoff);
		if (live.length !== (this.providerAlerts.get(accountId) || []).length) {
			this.providerAlerts.set(accountId, live);
		}
		return live;
	}

	/** Build the prompt, call the provider (timeout + fallbacks), parse and guard. */
	async generate(input: AgentGenerationInput): Promise<AgentGenerationOutput> {
		const hits = input.settings.useKnowledgeBase ? retrieveKnowledge(input.knowledgeDocs, input.query) : [];
		const { prompt, knowledge } = buildAgentPrompt({
			settings: promptSettings(input.settings),
			recent: input.recent,
			relevantHistory: input.relevantHistory,
			knowledge: hits,
			memory: input.memory,
			isFirstAgentReply: input.isFirstAgentReply,
			mediaNote: input.mediaNote,
		});
		const model = String(input.settings.model || 'auto').trim() || 'auto';
		const startedAt = Date.now();
		const selected = String(input.settings.provider || 'ai-free');
		const fallbacks: ProviderFailure[] = [];
		let raw: { text: string; actualModel: string | null } | null = null;
		let usedProvider = selected;

		for (const name of providerFallbackChain(selected)) {
			try {
				raw = await this.invokeProvider(name, input.settings, prompt, model);
				if (!String(raw.text || '').trim()) throw new Error('Provider returned an empty reply');
				usedProvider = name;
				break;
			} catch (error) {
				const message = errorText(error);
				fallbacks.push({ provider: name, error: message });
				this.recordProviderAlert(input.settings.accountId, name, message);
				this.logger.warn(`AI agent provider ${name} failed: ${message}`);
				raw = null;
			}
		}
		if (!raw) {
			throw new Error(fallbacks[fallbacks.length - 1]?.error || 'No AI provider is available');
		}
		if (fallbacks.length) {
			this.markProviderRecovery(input.settings.accountId, usedProvider, fallbacks);
		}
		const result = parseAgentResult(raw.text);
		const knowledgeIds = new Set(knowledge.map(doc => doc.id));
		result.usedKnowledgeIds = result.usedKnowledgeIds.filter(id => knowledgeIds.has(id));
		const guard = applyGuards({
			result,
			permissions: resolvePermissions(input.settings.permissions),
			forbiddenTopics: input.settings.forbiddenTopics,
			minConfidence: input.settings.minConfidence,
			knowledgeTexts: knowledge.map(doc => `${doc.title} ${doc.content}`),
			conversationTexts: [...input.recent, ...input.relevantHistory].map(item => item.content),
			previousAgentReplies: input.previousAgentReplies,
		});
		return {
			result,
			decision: guard.decision,
			reasons: guard.reasons,
			sources: sourcesFor(knowledge, hits, result.usedKnowledgeIds, {
				memory: Boolean(input.memory?.facts?.length || input.memory?.commitments?.length),
				history: input.relevantHistory.length,
			}),
			provider: usedProvider,
			model,
			actualModel: raw.actualModel ?? null,
			latencyMs: Date.now() - startedAt,
			fallbacks,
		};
	}

	private async invokeProvider(
		name: string,
		settings: EffectiveAgentSettings,
		prompt: string,
		model: string,
	) {
		if (name === 'external') return this.generateExternal(settings, prompt);
		const provider = this.providers.tryGet(name);
		if (!provider) throw new Error(`Provider ${name} is not available`);
		try {
			return await withTimeout(provider.generate({ prompt, model }), PROVIDER_TIMEOUT_MS);
		} catch (firstError) {
			if (!shouldRetrySameProvider(firstError)) throw firstError;
			this.logger.warn(
				`AI agent provider ${provider.name} failed once, retrying: ${errorText(firstError)}`,
			);
			return await withTimeout(provider.generate({ prompt, model }), PROVIDER_TIMEOUT_MS);
		}
	}

	private recordProviderAlert(accountId: string, provider: string, error: string) {
		if (!accountId) return;
		const next = this.getProviderAlerts(accountId).filter(item => item.provider !== provider);
		next.push({
			provider,
			error: error.slice(0, 180),
			at: new Date().toISOString(),
			recoveredBy: null,
		});
		this.providerAlerts.set(accountId, next.slice(-8));
	}

	private markProviderRecovery(accountId: string, recoveredBy: string, failures: ProviderFailure[]) {
		if (!accountId || !failures.length) return;
		const failed = new Set(failures.map(item => item.provider));
		this.providerAlerts.set(
			accountId,
			this.getProviderAlerts(accountId).map(item =>
				failed.has(item.provider) ? { ...item, recoveredBy } : item,
			),
		);
	}

	private async generateExternal(settings: EffectiveAgentSettings, prompt: string) {
		if (!settings.externalModelId || !this.externalRepo) {
			throw new Error('No external model is selected');
		}
		const row = await this.externalRepo
			.createQueryBuilder('model')
			.addSelect('model.encryptedApiKey')
			.where('model.id = :id AND model.accountId = :accountId', {
				id: settings.externalModelId,
				accountId: settings.accountId,
			})
			.getOne();
		if (!row?.isActive) throw new Error('The selected external model is missing or inactive');
		const secret = this.config?.get<string>('JWT_SECRET') || 'so7bafit-dev-secret';
		const apiKey = row.encryptedApiKey ? decryptAgentSecret(row.encryptedApiKey, secret) : null;
		return generateOpenAiCompatible({
			baseUrl: row.baseUrl,
			model: row.model,
			apiKey,
			prompt,
			timeoutMs: PROVIDER_TIMEOUT_MS,
		});
	}

	/* -------------------------------------------------------------- actions */

	private async handoff(
		conversation: WhatsAppConversation,
		settings: EffectiveAgentSettings,
		mode: AgentEffectiveMode,
		runId: string,
		finish: (patch: Partial<WhatsAppAiAgentRun>) => Promise<unknown>,
		sample: string,
		reasons: string[],
		modelReply: string | null = null,
	) {
		const text = modelReply?.trim() || settings.handoffMessage?.trim() || defaultHandoffMessage(sample);
		let replyMessageId: string | null = null;
		if (mode === 'auto') {
			const sent = await this.sendAsAgent(conversation, settings, runId, text);
			if (sent.ok) replyMessageId = sent.messageId;
		}
		await finish({ outcome: 'handoff', reasons, reply: text, replyMessageId });
		await this.updateState(conversation, {
			status: 'handoff',
			statusReason: reasons[0] || 'handoff',
			pausedUntil: new Date(Date.now() + HANDOFF_PAUSE_MS),
			lastReplyAt: replyMessageId ? new Date() : undefined,
		});
	}

	private async suggest(
		conversation: WhatsAppConversation,
		runId: string,
		triggerMessageId: string,
		generated: AgentGenerationOutput,
		finish: (patch: Partial<WhatsAppAiAgentRun>) => Promise<unknown>,
	) {
		const suggestion: AgentPendingSuggestion = {
			runId,
			text: generated.result.reply,
			reasons: generated.reasons,
			sources: generated.sources,
			createdAt: new Date().toISOString(),
			triggerMessageId,
		};
		await finish({
			outcome: 'suggested',
			reasons: generated.reasons,
			reply: generated.result.reply || null,
			sources: generated.sources,
			provider: generated.provider,
			model: generated.actualModel || generated.model,
		});
		await this.updateState(conversation, {
			status: 'suggested',
			statusReason: generated.reasons[0] || null,
			pendingSuggestion: suggestion,
		});
	}

	private async sendAsAgent(
		conversation: WhatsAppConversation,
		settings: EffectiveAgentSettings,
		runId: string,
		text: string,
	): Promise<{ ok: boolean; messageId?: string; reason?: string }> {
		const body = String(text || '').trim();
		if (!body) return { ok: false, reason: 'empty_reply' };
		if (!settings.actorUserId) return { ok: false, reason: 'no_actor' };
		const actor = await this.userRepo.findOne({ where: { id: settings.actorUserId } });
		if (!actor) return { ok: false, reason: 'no_actor' };
		await this.runRepo.update(runId, { reply: body }).catch(() => undefined);
		try {
			const result: any = await this.sync.sendText(
				actor,
				conversation.id,
				body,
				undefined,
				`ai-agent-${runId}`,
			);
			const messageId = String(result?.message?.id || '');
			if (messageId) this.rememberOwnMessage(messageId);
			await this.audit
				?.write({
					actorUserId: actor.id,
					accountId: conversation.accountId,
					action: 'whatsapp.ai_agent.reply_sent',
					targetType: 'WhatsAppMessage',
					targetId: messageId || null,
					metadata: { conversationId: conversation.id, runId },
				})
				.catch(() => undefined);
			return messageId ? { ok: true, messageId } : { ok: false, reason: 'send_failed' };
		} catch (error) {
			this.logger.warn(
				`AI agent send failed for ${conversation.id}: ${error instanceof Error ? error.message : error}`,
			);
			return { ok: false, reason: 'send_failed' };
		}
	}

	rememberOwnMessage(messageId: string) {
		const now = Date.now();
		this.ownMessageIds.set(messageId, now);
		if (this.ownMessageIds.size > 2_000) {
			for (const [id, at] of this.ownMessageIds) {
				if (now - at > 10 * 60_000) this.ownMessageIds.delete(id);
			}
		}
	}

	private async rememberFacts(
		conversation: WhatsAppConversation,
		settings: EffectiveAgentSettings,
		result: AgentModelResult,
		sent: boolean,
	) {
		if (!settings.useContactMemory) return;
		const facts = result.memory.facts;
		const commitments = sent ? result.memory.commitments : [];
		if (!facts.length && !commitments.length) return;
		const current = await this.memoryRepo.findOne({ where: { conversationId: conversation.id } });
		await this.memoryRepo.save(
			this.memoryRepo.create({
				...(current || {}),
				conversationId: conversation.id,
				accountId: conversation.accountId,
				facts: mergeMemory(current?.facts || [], facts, { max: 30 }),
				commitments: mergeMemory(current?.commitments || [], commitments, { max: 20 }),
			}),
		);
	}

	/* ---------------------------------------------------------------- data */

	private async claimRun(conversation: WhatsAppConversation, triggerMessageId: string) {
		const rows = await this.runRepo.query(
			`INSERT INTO whatsapp_ai_agent_runs (account_id, conversation_id, trigger_message_id, outcome)
			VALUES ($1, $2, $3, 'running')
			ON CONFLICT (conversation_id, trigger_message_id) DO NOTHING
			RETURNING id`,
			[conversation.accountId, conversation.id, triggerMessageId],
		);
		const id = Array.isArray(rows) ? rows[0]?.id : null;
		return id ? String(id) : null;
	}

	private async recentMessages(conversationId: string, limit: number) {
		const rows = await this.messageRepo.find({
			where: { conversationId, deletedMode: 'none', providerDeletedAt: IsNull() },
			order: { providerTimestamp: 'DESC', id: 'DESC' },
			take: Math.min(Math.max(Number(limit) || 12, 4), 40),
			select: ['id', 'direction', 'type', 'text', 'providerTimestamp', 'senderUserId'],
		});
		return rows.reverse();
	}

	private async relevantHistory(
		conversationId: string,
		oldestRecent: WhatsAppMessage | undefined,
		query: string,
	): Promise<AgentContextMessage[]> {
		if (!oldestRecent) return [];
		const candidates = await this.messageRepo.find({
			where: {
				conversationId,
				deletedMode: 'none',
				providerTimestamp: LessThan(oldestRecent.providerTimestamp),
				text: Not(IsNull()),
			},
			order: { providerTimestamp: 'DESC' },
			take: 300,
			select: ['id', 'direction', 'type', 'text', 'providerTimestamp'],
		});
		return rankRelevantHistory(candidates, query, 4)
			.sort((a, b) => new Date(a.providerTimestamp).getTime() - new Date(b.providerTimestamp).getTime())
			.map(row => ({
				role: row.direction === WhatsAppMessageDirection.OUTBOUND ? 'agent' : 'customer',
				content: agentMessageContent(row),
				at: new Date(row.providerTimestamp).toISOString(),
			}));
	}

	async knowledgeDocs(accountId: string): Promise<KnowledgeDoc[]> {
		const rows = await this.knowledgeRepo.find({
			where: { accountId, isActive: true },
			order: { updated_at: 'DESC' },
			take: MAX_KNOWLEDGE_ENTRIES,
		});
		return rows.map(row => ({
			id: row.id,
			title: row.title,
			content: row.content,
			category: row.category,
			tags: Array.isArray(row.tags) ? row.tags : [],
		}));
	}

	private async previousAgentReplies(conversationId: string) {
		const rows = await this.runRepo.find({
			where: { conversationId, outcome: In(['sent', 'approved', 'handoff']) },
			order: { created_at: 'DESC' },
			take: 5,
			select: ['id', 'reply'],
		});
		return rows.map(row => String(row.reply || '')).filter(Boolean);
	}

	/** Provider echo of an agent send that landed before the app-side row was linked. */
	private async isRecentAgentEcho(message: WhatsAppMessage) {
		const text = normalizeForSearch(message.text || '');
		if (!text) return false;
		const recent = await this.runRepo.find({
			where: {
				conversationId: message.conversationId,
				outcome: In(['running', 'sent', 'approved', 'handoff']),
				created_at: MoreThan(new Date(Date.now() - 3 * 60_000)),
			},
			select: ['id', 'reply'],
			take: 5,
		});
		return recent.some(run => run.reply && normalizeForSearch(run.reply) === text);
	}

	private async isAgentMessage(messageId: string) {
		if (this.ownMessageIds.has(messageId)) return true;
		return (await this.runRepo.count({ where: { replyMessageId: messageId } })) > 0;
	}

	/* --------------------------------------------------------------- state */

	async updateState(
		conversation: Pick<WhatsAppConversation, 'id' | 'accountId' | 'assignedUserId' | 'providerChatId'>,
		patch: Partial<Pick<
			WhatsAppAiAgentConversation,
			'mode' | 'status' | 'statusReason' | 'pausedUntil' | 'lastReplyAt' | 'lastError' | 'pendingSuggestion' | 'updatedBy'
		>>,
	) {
		const state = await this.loadState(conversation);
		for (const [key, value] of Object.entries(patch)) {
			if (value !== undefined) (state as any)[key] = value;
		}
		const saved = await this.stateRepo.save(state);
		await this.emitState(conversation, saved);
		return saved;
	}

	async emitState(
		conversation: Pick<WhatsAppConversation, 'id' | 'accountId' | 'assignedUserId'>,
		state: WhatsAppAiAgentConversation,
		statusOverride?: AgentStatus,
	) {
		const settings = await this.getSettings(conversation.accountId).catch(() => null);
		this.gateway.emitAccountEvent(
			conversation.accountId,
			AGENT_STATE_EVENT,
			serializeAgentState(state, settings, statusOverride),
			{ assignedUserId: conversation.assignedUserId ?? null },
		);
	}

	/** Replaces a transient "waiting" chip with the stored state once a run ends (incl. early exits). */
	private async emitSettled(conversationId: string) {
		try {
			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
				select: ['id', 'accountId', 'assignedUserId'],
			});
			if (!conversation) return;
			await this.emitState(conversation, await this.loadState(conversation));
		} catch {
			/* live indicator only */
		}
	}

	private async emitTransient(accountId: string, conversationId: string, status: AgentStatus) {
		try {
			const conversation = await this.conversationRepo.findOne({
				where: { id: conversationId },
				select: ['id', 'accountId', 'assignedUserId'],
			});
			if (!conversation || conversation.accountId !== accountId) return;
			const state = await this.loadState(conversation);
			await this.emitState(conversation, state, status);
		} catch {
			/* live indicator only */
		}
	}
}

export function serializeAgentState(
	state: Pick<
		WhatsAppAiAgentConversation,
		'conversationId' | 'mode' | 'status' | 'statusReason' | 'pausedUntil' | 'lastReplyAt' | 'lastError' | 'pendingSuggestion'
	>,
	settings: Pick<EffectiveAgentSettings, 'enabled' | 'scope' | 'defaultMode'> | null,
	statusOverride?: AgentStatus,
) {
	const pausedUntil = state.pausedUntil ? new Date(state.pausedUntil) : null;
	const paused = Boolean(pausedUntil && pausedUntil.getTime() > Date.now());
	return {
		conversationId: state.conversationId,
		mode: state.mode,
		effectiveMode: resolveEffectiveMode(settings, state.mode),
		status: statusOverride || (state.status === 'paused' && !paused ? 'idle' : state.status),
		statusReason: state.statusReason,
		pausedUntil: paused ? pausedUntil!.toISOString() : null,
		lastReplyAt: state.lastReplyAt ? new Date(state.lastReplyAt).toISOString() : null,
		lastError: state.status === 'error' ? state.lastError : null,
		pendingSuggestion: state.pendingSuggestion
			? {
				runId: state.pendingSuggestion.runId,
				text: state.pendingSuggestion.text,
				reasons: state.pendingSuggestion.reasons,
				sources: state.pendingSuggestion.sources,
				createdAt: state.pendingSuggestion.createdAt,
			}
			: null,
	};
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		if (predicate(items[index])) return index;
	}
	return -1;
}
