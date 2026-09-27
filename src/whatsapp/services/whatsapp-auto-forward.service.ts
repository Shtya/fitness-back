import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	CreateWhatsAppAutoForwardRuleDto,
	UpdateWhatsAppAutoForwardRuleDto,
} from '../dto/whatsapp-auto-forward.dto';
import {
	WhatsAppAutoForwardMode,
	WhatsAppAutoForwardRule,
	WhatsAppConversation,
	WhatsAppMessage,
} from '../entities/whatsapp.entity';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppAuditService } from './whatsapp-audit.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

const RULE_RELATIONS = [
	'sourceConversation',
	'sourceConversation.contact',
	'sourceConversation.group',
	'targetConversation',
	'targetConversation.contact',
	'targetConversation.group',
];

function conversationLabel(conversation?: WhatsAppConversation | null) {
	if (!conversation) return null;
	return (
		conversation.group?.subject ||
		conversation.contact?.name ||
		conversation.contact?.phoneNumber ||
		conversation.providerChatId ||
		null
	);
}

@Injectable()
export class WhatsAppAutoForwardService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(WhatsAppAutoForwardService.name);
	private unsubscribe?: () => void;
	/** Per-rule chain so bursts are forwarded in arrival order. */
	private ruleChains = new Map<string, Promise<void>>();

	constructor(
		@InjectRepository(WhatsAppAutoForwardRule)
		private readonly ruleRepo: Repository<WhatsAppAutoForwardRule>,
		@InjectRepository(User)
		private readonly userRepo: Repository<User>,
		private readonly access: WhatsAppAccessService,
		private readonly sync: WhatsAppSyncService,
		private readonly audit: WhatsAppAuditService,
	) {}

	onModuleInit() {
		this.unsubscribe = this.sync.onInboundMessagePersisted((accountId, message) =>
			this.handleInbound(accountId, message),
		);
	}

	onModuleDestroy() {
		this.unsubscribe?.();
	}

	async listForAccount(user: User, accountId: string) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canView) throw new ForbiddenException('WhatsApp access denied');
		const rules = await this.ruleRepo.find({
			where: { accountId },
			relations: RULE_RELATIONS,
			order: { created_at: 'DESC' },
		});
		return rules.map(rule => this.serialize(rule));
	}

	async create(user: User, accountId: string, dto: CreateWhatsAppAutoForwardRuleDto) {
		const accountAccess = await this.access.getAccountAccess(user, accountId);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		if (dto.sourceConversationId === dto.targetConversationId) {
			throw new BadRequestException('Source and target chats must be different');
		}
		for (const conversationId of [dto.sourceConversationId, dto.targetConversationId]) {
			const visible = await this.access.assertConversationVisible(user, conversationId);
			if (visible.conversation.accountId !== accountId) {
				throw new BadRequestException('Both chats must belong to this WhatsApp account');
			}
		}

		const mode: WhatsAppAutoForwardMode = dto.mode === 'copy' ? 'copy' : 'forward';
		const pairs: Array<[string, string]> = [[dto.sourceConversationId, dto.targetConversationId]];
		if (dto.bidirectional) pairs.push([dto.targetConversationId, dto.sourceConversationId]);

		const savedIds: string[] = [];
		for (const [sourceConversationId, targetConversationId] of pairs) {
			const existing = await this.ruleRepo.findOne({
				where: { sourceConversationId, targetConversationId },
			});
			if (existing) {
				await this.ruleRepo.update(existing.id, { mode, isActive: true, lastError: null });
				savedIds.push(existing.id);
				continue;
			}
			const saved = await this.ruleRepo.save(
				this.ruleRepo.create({
					accountId,
					createdByUserId: user.id,
					sourceConversationId,
					targetConversationId,
					mode,
					isActive: true,
				}),
			);
			savedIds.push(saved.id);
		}

		await this.audit.write({
			actorUserId: user.id,
			accountId,
			action: 'whatsapp.auto_forward.created',
			targetType: 'WhatsAppAutoForwardRule',
			targetId: savedIds[0],
			metadata: {
				sourceConversationId: dto.sourceConversationId,
				targetConversationId: dto.targetConversationId,
				mode,
				bidirectional: Boolean(dto.bidirectional),
			},
		});

		const rules = await this.ruleRepo.find({
			where: savedIds.map(id => ({ id })),
			relations: RULE_RELATIONS,
		});
		return rules.map(rule => this.serialize(rule));
	}

	async update(user: User, ruleId: string, dto: UpdateWhatsAppAutoForwardRuleDto) {
		const rule = await this.getManageableRule(user, ruleId);
		const changes: Partial<WhatsAppAutoForwardRule> = {};
		if (typeof dto.isActive === 'boolean') changes.isActive = dto.isActive;
		if (dto.mode) changes.mode = dto.mode === 'copy' ? 'copy' : 'forward';
		if (!Object.keys(changes).length) return this.serialize(rule);
		if (changes.isActive) changes.lastError = null;
		await this.ruleRepo.update(rule.id, changes);
		await this.audit.write({
			actorUserId: user.id,
			accountId: rule.accountId,
			action: 'whatsapp.auto_forward.updated',
			targetType: 'WhatsAppAutoForwardRule',
			targetId: rule.id,
			metadata: changes,
		});
		const fresh = await this.ruleRepo.findOneOrFail({
			where: { id: rule.id },
			relations: RULE_RELATIONS,
		});
		return this.serialize(fresh);
	}

	async remove(user: User, ruleId: string) {
		const rule = await this.getManageableRule(user, ruleId);
		await this.ruleRepo.delete(rule.id);
		await this.audit.write({
			actorUserId: user.id,
			accountId: rule.accountId,
			action: 'whatsapp.auto_forward.deleted',
			targetType: 'WhatsAppAutoForwardRule',
			targetId: rule.id,
			metadata: {
				sourceConversationId: rule.sourceConversationId,
				targetConversationId: rule.targetConversationId,
			},
		});
		return { ok: true, id: rule.id };
	}

	private async getManageableRule(user: User, ruleId: string) {
		const rule = await this.ruleRepo.findOne({ where: { id: ruleId }, relations: RULE_RELATIONS });
		if (!rule) throw new NotFoundException('Auto-forward rule not found');
		const accountAccess = await this.access.getAccountAccess(user, rule.accountId);
		if (!accountAccess.canUse) throw new ForbiddenException('WhatsApp send access denied');
		return rule;
	}

	private async handleInbound(accountId: string, message: WhatsAppMessage) {
		const rules = await this.ruleRepo.find({
			where: { accountId, sourceConversationId: message.conversationId, isActive: true },
		});
		for (const rule of rules) {
			const previous = this.ruleChains.get(rule.id) || Promise.resolve();
			const next = previous.then(() => this.forwardOne(rule, message));
			this.ruleChains.set(rule.id, next);
			void next.finally(() => {
				if (this.ruleChains.get(rule.id) === next) this.ruleChains.delete(rule.id);
			});
		}
	}

	private async forwardOne(rule: WhatsAppAutoForwardRule, message: WhatsAppMessage) {
		try {
			const actor = await this.userRepo.findOne({ where: { id: rule.createdByUserId } });
			if (!actor) {
				await this.ruleRepo.update(rule.id, {
					isActive: false,
					lastError: 'Rule creator no longer exists',
				});
				return;
			}
			if (rule.mode === 'copy') {
				await this.sync.shareMessagesAsOriginal(
					actor,
					rule.sourceConversationId,
					[message.id],
					rule.targetConversationId,
				);
			} else {
				await this.sync.forwardMessage(
					actor,
					rule.sourceConversationId,
					message.id,
					rule.targetConversationId,
				);
			}
			await this.ruleRepo
				.createQueryBuilder()
				.update()
				.set({
					forwardedCount: () => 'forwarded_count + 1',
					lastForwardedAt: new Date(),
					lastError: null,
				})
				.where('id = :id', { id: rule.id })
				.execute();
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error || 'Failed');
			this.logger.warn(`Auto-forward rule ${rule.id} failed for message ${message.id}: ${detail}`);
			await this.ruleRepo
				.update(rule.id, { lastError: detail.slice(0, 500) })
				.catch(() => undefined);
		}
	}

	private serialize(rule: WhatsAppAutoForwardRule) {
		return {
			id: rule.id,
			accountId: rule.accountId,
			sourceConversationId: rule.sourceConversationId,
			targetConversationId: rule.targetConversationId,
			sourceTitle: conversationLabel(rule.sourceConversation),
			targetTitle: conversationLabel(rule.targetConversation),
			mode: rule.mode,
			isActive: rule.isActive,
			forwardedCount: rule.forwardedCount,
			lastForwardedAt: rule.lastForwardedAt,
			lastError: rule.lastError,
			createdAt: rule.created_at,
		};
	}
}
