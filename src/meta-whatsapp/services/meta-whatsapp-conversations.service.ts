import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FitnessLead } from '../../fitness-leads/entities/fitness-leads.entity';
import {
	MetaWaMessageDirection,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import { isWithinCustomerCareWindow, bestMessageTimestamp, normalizeWaId, CUSTOMER_CARE_WINDOW_MS } from './meta-whatsapp-crypto.service';

@Injectable()
export class MetaWhatsAppConversationsService {
	constructor(
		@InjectRepository(MetaWhatsAppConversation)
		private readonly conversationRepo: Repository<MetaWhatsAppConversation>,
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		@InjectRepository(FitnessLead)
		private readonly leadRepo: Repository<FitnessLead>,
	) {}

	async list(q?: string, limit = 50, filter?: string) {
		const normalizedFilter = String(filter || 'all').trim().toLowerCase();
		const maxLimit =
			normalizedFilter === 'replied' ||
			normalizedFilter === 'window24h' ||
			normalizedFilter === 'unreplied'
				? 5000
				: 500;
		const qb = this.conversationRepo
			.createQueryBuilder('c')
			.orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
			.take(Math.min(Math.max(Number(limit) || 50, 1), maxLimit));

		if (q?.trim()) {
			const term = `%${q.trim().toLowerCase()}%`;
			qb.andWhere(
				`(LOWER(COALESCE(c.display_name, '')) LIKE :term OR LOWER(COALESCE(c.business_name, '')) LIKE :term OR c.wa_id LIKE :digits)`,
				{ term, digits: `%${q.replace(/\D/g, '')}%` },
			);
		}

		if (normalizedFilter === 'unread') {
			qb.andWhere('c.unread_count > 0');
		} else if (normalizedFilter === 'leads') {
			qb.andWhere('c.lead_id IS NOT NULL');
		} else if (normalizedFilter === 'fav') {
			qb.andWhere('c.is_favorite = true');
		} else if (normalizedFilter === 'window24h') {
			qb.andWhere('c.last_inbound_at IS NOT NULL').andWhere(
				`c.last_inbound_at > NOW() - INTERVAL '24 hours'`,
			);
		} else if (normalizedFilter === 'unreplied') {
			// Customer’s last message is waiting — we haven’t sent anything after it.
			this.applyUnrepliedFilter(qb);
		} else if (normalizedFilter === 'replied') {
			qb.andWhere(
				`EXISTS (
					SELECT 1
					FROM meta_whatsapp_messages t
					INNER JOIN meta_whatsapp_messages r
						ON r.conversation_id = t.conversation_id
						AND r.direction = :inbound
						AND r.created_at > t.created_at
					WHERE t.conversation_id = c.id
						AND t.direction = :outbound
						AND LOWER(t.message_type) = :templateType
				)`,
			).setParameters({
				inbound: MetaWaMessageDirection.INBOUND,
				outbound: MetaWaMessageDirection.OUTBOUND,
				templateType: 'template',
			});
		}

		const rows = await qb.getMany();
		const repliedIds =
			normalizedFilter === 'replied'
				? new Set(rows.map(c => c.id))
				: await this.findRepliedToTemplateIds(rows.map(c => c.id));
		return rows.map(c =>
			this.serializeConversation(c, { repliedToTemplate: repliedIds.has(c.id) }),
		);
	}

	async filterCounts() {
		const base = () => this.conversationRepo.createQueryBuilder('c');

		const unrepliedQb = base();
		this.applyUnrepliedFilter(unrepliedQb);

		const repliedQb = base()
			.where(
				`EXISTS (
					SELECT 1
					FROM meta_whatsapp_messages t
					INNER JOIN meta_whatsapp_messages r
						ON r.conversation_id = t.conversation_id
						AND r.direction = :inbound
						AND r.created_at > t.created_at
					WHERE t.conversation_id = c.id
						AND t.direction = :outbound
						AND LOWER(t.message_type) = :templateType
				)`,
			)
			.setParameters({
				inbound: MetaWaMessageDirection.INBOUND,
				outbound: MetaWaMessageDirection.OUTBOUND,
				templateType: 'template',
			});

		const [
			all,
			unread,
			unreadMessagesRow,
			leads,
			fav,
			replied,
			window24h,
			unreplied,
		] = await Promise.all([
			base().getCount(),
			base().andWhere('c.unread_count > 0').getCount(),
			base()
				.select('COALESCE(SUM(c.unread_count), 0)', 'unreadMessages')
				.getRawOne(),
			base().andWhere('c.lead_id IS NOT NULL').getCount(),
			base().andWhere('c.is_favorite = true').getCount(),
			repliedQb.getCount(),
			base()
				.andWhere('c.last_inbound_at IS NOT NULL')
				.andWhere(`c.last_inbound_at > NOW() - INTERVAL '24 hours'`)
				.getCount(),
			unrepliedQb.getCount(),
		]);

		return {
			all: Number(all) || 0,
			unread: Number(unread) || 0,
			unreadMessages: Number(unreadMessagesRow?.unreadMessages) || 0,
			leads: Number(leads) || 0,
			fav: Number(fav) || 0,
			replied: Number(replied) || 0,
			window24h: Number(window24h) || 0,
			unreplied: Number(unreplied) || 0,
		};
	}

	/** Last activity is inbound — business has not replied yet. */
	private applyUnrepliedFilter(qb: any) {
		qb.andWhere('c.last_inbound_at IS NOT NULL')
			.andWhere('c.last_message_at IS NOT NULL')
			.andWhere('c.last_inbound_at >= c.last_message_at')
			.andWhere(
				`EXISTS (
					SELECT 1
					FROM meta_whatsapp_messages m
					WHERE m.conversation_id = c.id
						AND m.direction = :unrepliedInbound
						AND m.created_at = (
							SELECT MAX(m2.created_at)
							FROM meta_whatsapp_messages m2
							WHERE m2.conversation_id = c.id
						)
				)`,
			)
			.setParameter('unrepliedInbound', MetaWaMessageDirection.INBOUND);
		return qb;
	}

	async findRepliedToTemplateIds(conversationIds: string[]) {
		const ids = [...new Set(conversationIds.filter(Boolean))];
		if (!ids.length) return new Set<string>();

		const rows = await this.messageRepo
			.createQueryBuilder('t')
			.select('DISTINCT t.conversation_id', 'conversationId')
			.innerJoin(
				MetaWhatsAppMessage,
				'r',
				`r.conversation_id = t.conversation_id
					AND r.direction = :inbound
					AND r.created_at > t.created_at`,
			)
			.where('t.conversation_id IN (:...ids)', { ids })
			.andWhere('t.direction = :outbound')
			.andWhere('LOWER(t.message_type) = :templateType')
			.setParameters({
				inbound: MetaWaMessageDirection.INBOUND,
				outbound: MetaWaMessageDirection.OUTBOUND,
				templateType: 'template',
			})
			.getRawMany<{ conversationId: string }>();

		return new Set(rows.map(row => row.conversationId).filter(Boolean));
	}

	async findEntity(conversationId: string) {
		const c = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!c) throw new NotFoundException('Conversation not found');
		return c;
	}

	async get(conversationId: string) {
		const conversation = await this.findEntity(conversationId);
		await this.syncLastInboundAt(conversation);
		return this.toConversationDto(conversation);
	}

	async syncLastInboundAtById(conversationId: string) {
		const conversation = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!conversation) return null;
		return this.syncLastInboundAt(conversation);
	}

	/**
	 * Keep customer-care window in sync with stored inbound messages.
	 * Repairs cases where webhooks saved the message but lastInboundAt stayed null/stale.
	 */
	async syncLastInboundAt(conversation: MetaWhatsAppConversation) {
		const lastInbound = await this.messageRepo.findOne({
			where: {
				conversationId: conversation.id,
				direction: MetaWaMessageDirection.INBOUND,
			},
			order: { createdAt: 'DESC' },
		});
		if (!lastInbound) return conversation;

		const next = bestMessageTimestamp(lastInbound.createdAt, lastInbound.providerTimestamp);
		if (!next) return conversation;

		const current = bestMessageTimestamp(conversation.lastInboundAt);
		if (next <= current) {
			// Still refresh DTO window if stored lastInboundAt is broken/old vs messages.
			if (!isWithinCustomerCareWindow(conversation.lastInboundAt) && isWithinCustomerCareWindow(new Date(next))) {
				conversation.lastInboundAt = new Date(next);
				return this.conversationRepo.save(conversation);
			}
			return conversation;
		}

		conversation.lastInboundAt = new Date(next);
		return this.conversationRepo.save(conversation);
	}

	async messages(conversationId: string, limit = 100, before?: string) {
		const conversation = await this.findEntity(conversationId);
		await this.syncLastInboundAt(conversation);

		const qb = this.messageRepo
			.createQueryBuilder('m')
			.where('m.conversation_id = :conversationId', { conversationId })
			.orderBy('m.created_at', 'DESC')
			.take(Math.min(Math.max(limit, 1), 200));
		if (before) {
			qb.andWhere('m.created_at < :before', { before: new Date(before) });
		}
		const rows = await qb.getMany();
		const messages = rows.reverse().map(m => this.serializeMessage(m));
		const care = await this.resolveCustomerCareWindow(conversationId, conversation);
		return {
			messages,
			...care,
		};
	}

	/**
	 * Source of truth for the compose bar: latest inbound message time (createdAt).
	 * Window is open for 24h from that timestamp.
	 */
	async resolveCustomerCareWindow(
		conversationId: string,
		conversation?: MetaWhatsAppConversation | null,
	) {
		const lastInbound = await this.messageRepo.findOne({
			where: {
				conversationId,
				direction: MetaWaMessageDirection.INBOUND,
			},
			order: { createdAt: 'DESC' },
		});

		const lastInboundAtMs = lastInbound
			? bestMessageTimestamp(lastInbound.createdAt, lastInbound.providerTimestamp)
			: bestMessageTimestamp(conversation?.lastInboundAt);

		const lastInboundAt = lastInboundAtMs ? new Date(lastInboundAtMs) : null;
		const withinWindow = isWithinCustomerCareWindow(lastInboundAt);
		const remainingMs = withinWindow && lastInboundAtMs
			? Math.max(0, CUSTOMER_CARE_WINDOW_MS - (Date.now() - lastInboundAtMs))
			: 0;

		return {
			lastInboundAt,
			withinCustomerCareWindow: withinWindow,
			canSendFreeform: withinWindow,
			requiresTemplate: !withinWindow,
			customerCareRemainingMs: remainingMs,
		};
	}

	async markRead(conversationId: string) {
		const c = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!c) throw new NotFoundException('Conversation not found');
		c.unreadCount = 0;
		await this.conversationRepo.save(c);
		await this.syncLastInboundAt(c);

		const lastInbound = await this.messageRepo.findOne({
			where: {
				conversationId,
				direction: MetaWaMessageDirection.INBOUND,
			},
			order: { createdAt: 'DESC' },
		});

		return {
			conversation: await this.toConversationDto(c),
			lastInboundWamid: lastInbound?.wamid || null,
		};
	}

	async setFavorite(conversationId: string, isFavorite: boolean) {
		const c = await this.findEntity(conversationId);
		c.isFavorite = Boolean(isFavorite);
		await this.conversationRepo.save(c);
		return this.toConversationDto(c);
	}

	async openByPhone(phone: string, displayName?: string) {
		const waId = normalizeWaId(phone);
		if (!waId) {
			throw new BadRequestException(
				'Invalid phone number. Use country code, e.g. 2010xxxxxxx or +20 10 xxxx xxxx',
			);
		}
		const lead = await this.leadRepo
			.createQueryBuilder('l')
			.where(`regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') = :waId`, { waId })
			.getOne()
			.catch(() => null);
		const conversation = await this.findOrCreateByWaId({
			waId,
			leadId: lead?.id || null,
			displayName: displayName || lead?.businessName || waId,
			businessName: lead?.businessName || null,
		});
		const messageCount = await this.messageRepo.count({
			where: { conversationId: conversation.id },
		});
		return {
			...(await this.toConversationDto(conversation)),
			messageCount,
			syncedFromDb: true,
			metaHistoryNote:
				'Meta Cloud API does not expose historical WhatsApp chats from before the webhook was connected. Showing messages stored in this system only.',
		};
	}

	serializeMessage(m: MetaWhatsAppMessage) {
		let mediaId = m.mediaId;
		let mediaMimeType = m.mediaMimeType;
		const raw = m.rawPayload;
		if (!mediaId && raw && typeof raw === 'object') {
			const bucket =
				raw.sticker ||
				raw.image ||
				raw.video ||
				raw.audio ||
				raw.document ||
				null;
			if (bucket?.id) {
				mediaId = String(bucket.id);
				mediaMimeType = bucket.mime_type || mediaMimeType;
			}
		}
		const hasMedia = Boolean(mediaId || m.mediaUrl);
		return {
			id: m.id,
			conversationId: m.conversationId,
			direction: m.direction,
			messageType: m.messageType,
			body: m.body,
			templateName: m.templateName,
			templateLanguage: m.templateLanguage,
			templateComponents: m.templateComponents,
			wamid: m.wamid,
			status: m.status,
			errorCode: m.errorCode,
			errorMessage: m.errorMessage,
			mediaId: mediaId || null,
			mediaMimeType: mediaMimeType || null,
			mediaFileName: m.mediaFileName,
			mediaUrl: hasMedia ? `/meta-whatsapp/messages/${m.id}/media` : null,
			hasMedia,
			sentBy: m.sentBy,
			leadId: m.leadId,
			providerTimestamp: m.providerTimestamp,
			createdAt: m.createdAt,
			updatedAt: m.updatedAt,
		};
	}

	async openForLead(leadId: string) {
		const lead = await this.leadRepo.findOne({ where: { id: leadId } });
		if (!lead) throw new NotFoundException('Lead not found');
		const waId = normalizeWaId(lead.phone);
		if (!waId) throw new NotFoundException('Lead has no valid WhatsApp phone number');

		let conversation = await this.conversationRepo.findOne({ where: { waId } });
		if (!conversation) {
			conversation = this.conversationRepo.create({
				waId,
				leadId: lead.id,
				displayName: lead.businessName || waId,
				businessName: lead.businessName || null,
			});
		} else {
			conversation.leadId = lead.id;
			conversation.businessName = lead.businessName || conversation.businessName;
			conversation.displayName =
				conversation.displayName || lead.businessName || waId;
		}
		await this.conversationRepo.save(conversation);
		return this.toConversationDto(conversation);
	}

	async findOrCreateByWaId(input: {
		waId: string;
		leadId?: string | null;
		displayName?: string | null;
		businessName?: string | null;
	}) {
		const waId = normalizeWaId(input.waId);
		if (!waId) throw new NotFoundException('Invalid WhatsApp id');
		let conversation = await this.conversationRepo.findOne({ where: { waId } });

		// Migrate legacy rows stored as local EG 01… into E.164 201…
		if (!conversation && waId.startsWith('20') && waId.length >= 11) {
			const local = `0${waId.slice(2)}`;
			const legacy = await this.conversationRepo.findOne({ where: { waId: local } });
			if (legacy) {
				legacy.waId = waId;
				conversation = legacy;
			}
		}

		if (!conversation) {
			conversation = this.conversationRepo.create({
				waId,
				leadId: input.leadId || null,
				displayName: input.displayName || input.businessName || waId,
				businessName: input.businessName || null,
			});
		} else {
			if (input.leadId) conversation.leadId = input.leadId;
			if (input.displayName) conversation.displayName = input.displayName;
			if (input.businessName) conversation.businessName = input.businessName;
		}
		return this.conversationRepo.save(conversation);
	}

	async touchConversation(
		conversation: MetaWhatsAppConversation,
		preview: string,
		opts?: { inbound?: boolean; bumpUnread?: boolean },
	) {
		const now = new Date();
		conversation.lastMessagePreview = preview.slice(0, 500);
		conversation.lastMessageAt = now;
		if (opts?.inbound) conversation.lastInboundAt = now;
		if (opts?.bumpUnread) conversation.unreadCount = (conversation.unreadCount || 0) + 1;
		return this.conversationRepo.save(conversation);
	}

	async toConversationDto(c: MetaWhatsAppConversation) {
		const repliedIds = await this.findRepliedToTemplateIds([c.id]);
		const care = await this.resolveCustomerCareWindow(c.id, c);
		return {
			...this.serializeConversation(c, {
				repliedToTemplate: repliedIds.has(c.id),
				lastInboundOverride: care.lastInboundAt,
			}),
			canSendFreeform: care.canSendFreeform,
			withinCustomerCareWindow: care.withinCustomerCareWindow,
			requiresTemplate: care.requiresTemplate,
			lastInboundAt: care.lastInboundAt,
			customerCareRemainingMs: care.customerCareRemainingMs,
		};
	}

	serializeConversation(
		c: MetaWhatsAppConversation,
		extra?: { repliedToTemplate?: boolean; lastInboundOverride?: Date | number | null },
	) {
		const inboundAt = extra?.lastInboundOverride ?? c.lastInboundAt;
		const withinWindow = isWithinCustomerCareWindow(
			inboundAt != null ? new Date(inboundAt) : c.lastInboundAt,
		);
		return {
			id: c.id,
			leadId: c.leadId,
			waId: c.waId,
			displayName: c.displayName,
			businessName: c.businessName,
			lastMessagePreview: c.lastMessagePreview,
			lastMessageAt: c.lastMessageAt,
			lastInboundAt: inboundAt ? new Date(inboundAt) : c.lastInboundAt,
			unreadCount: c.unreadCount,
			isFavorite: Boolean(c.isFavorite),
			repliedToTemplate: Boolean(extra?.repliedToTemplate),
			withinCustomerCareWindow: withinWindow,
			canSendFreeform: withinWindow,
			requiresTemplate: !withinWindow,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		};
	}
}
