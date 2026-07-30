import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FitnessLead } from '../../fitness-leads/entities/fitness-leads.entity';
import {
	MetaWaMessageDirection,
	MetaWhatsAppConversation,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import { isWithinCustomerCareWindow, normalizeWaId } from './meta-whatsapp-crypto.service';

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

	async list(q?: string, limit = 50) {
		const qb = this.conversationRepo
			.createQueryBuilder('c')
			.orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
			.take(Math.min(Math.max(limit, 1), 200));
		if (q?.trim()) {
			const term = `%${q.trim().toLowerCase()}%`;
			qb.andWhere(
				`(LOWER(COALESCE(c.display_name, '')) LIKE :term OR LOWER(COALESCE(c.business_name, '')) LIKE :term OR c.wa_id LIKE :digits)`,
				{ term, digits: `%${q.replace(/\D/g, '')}%` },
			);
		}
		const rows = await qb.getMany();
		return rows.map(c => this.serializeConversation(c));
	}

	async findEntity(conversationId: string) {
		const c = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!c) throw new NotFoundException('Conversation not found');
		return c;
	}

	async get(conversationId: string) {
		return this.serializeConversation(await this.findEntity(conversationId));
	}

	async messages(conversationId: string, limit = 100, before?: string) {
		await this.get(conversationId);
		const qb = this.messageRepo
			.createQueryBuilder('m')
			.where('m.conversation_id = :conversationId', { conversationId })
			.orderBy('m.created_at', 'DESC')
			.take(Math.min(Math.max(limit, 1), 200));
		if (before) {
			qb.andWhere('m.created_at < :before', { before: new Date(before) });
		}
		const rows = await qb.getMany();
		return rows.reverse().map(m => this.serializeMessage(m));
	}

	async markRead(conversationId: string) {
		const c = await this.conversationRepo.findOne({ where: { id: conversationId } });
		if (!c) throw new NotFoundException('Conversation not found');
		c.unreadCount = 0;
		await this.conversationRepo.save(c);

		const lastInbound = await this.messageRepo.findOne({
			where: {
				conversationId,
				direction: MetaWaMessageDirection.INBOUND,
			},
			order: { createdAt: 'DESC' },
		});

		return {
			conversation: this.serializeConversation(c),
			lastInboundWamid: lastInbound?.wamid || null,
		};
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
			...this.serializeConversation(conversation),
			messageCount,
			syncedFromDb: true,
			metaHistoryNote:
				'Meta Cloud API does not expose historical WhatsApp chats from before the webhook was connected. Showing messages stored in this system only.',
		};
	}

	serializeMessage(m: MetaWhatsAppMessage) {
		const hasMedia = Boolean(m.mediaId || m.mediaUrl);
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
			mediaId: m.mediaId,
			mediaMimeType: m.mediaMimeType,
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
		return this.serializeConversation(conversation);
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

	serializeConversation(c: MetaWhatsAppConversation) {
		const withinWindow = isWithinCustomerCareWindow(c.lastInboundAt);
		return {
			id: c.id,
			leadId: c.leadId,
			waId: c.waId,
			displayName: c.displayName,
			businessName: c.businessName,
			lastMessagePreview: c.lastMessagePreview,
			lastMessageAt: c.lastMessageAt,
			lastInboundAt: c.lastInboundAt,
			unreadCount: c.unreadCount,
			withinCustomerCareWindow: withinWindow,
			canSendFreeform: withinWindow,
			requiresTemplate: !withinWindow,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		};
	}
}
