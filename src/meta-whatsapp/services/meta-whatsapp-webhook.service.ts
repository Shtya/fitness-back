import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	MetaWaMessageDirection,
	MetaWaMessageStatus,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import { MetaWhatsAppCryptoService, normalizeWaId } from './meta-whatsapp-crypto.service';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';
import { MetaWhatsAppConversationsService } from './meta-whatsapp-conversations.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';
import { FitnessLead } from '../../fitness-leads/entities/fitness-leads.entity';

@Injectable()
export class MetaWhatsAppWebhookService {
	private readonly logger = new Logger(MetaWhatsAppWebhookService.name);

	constructor(
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		@InjectRepository(FitnessLead)
		private readonly leadRepo: Repository<FitnessLead>,
		private readonly crypto: MetaWhatsAppCryptoService,
		private readonly configService: MetaWhatsAppConfigService,
		private readonly conversations: MetaWhatsAppConversationsService,
		private readonly activity: MetaWhatsAppActivityService,
	) {}

	async verifyChallenge(query: {
		'hub.mode'?: string;
		'hub.verify_token'?: string;
		'hub.challenge'?: string;
	}) {
		const mode = query['hub.mode'];
		const token = query['hub.verify_token'];
		const challenge = query['hub.challenge'];
		if (mode !== 'subscribe' || !token || !challenge) {
			throw new UnauthorizedException('Invalid webhook verification request');
		}
		const runtime = await this.configService.resolveSecretsForWebhook();
		if (!runtime) throw new UnauthorizedException('Meta WhatsApp is not configured');
		const ok =
			this.crypto.verifyTokenMatches(token, runtime.config.verifyTokenHash) ||
			token === runtime.secrets.verifyToken;
		if (!ok) throw new UnauthorizedException('Verify token mismatch');
		await this.activity.log('webhook.verified', null, {});
		return challenge;
	}

	async handleIncoming(
		rawBody: Buffer | string | undefined,
		signatureHeader: string | undefined,
		payload: any,
	) {
		const runtime = await this.configService.resolveSecretsForWebhook();
		if (!runtime?.secrets.appSecret) {
			this.logger.warn('Rejected Meta webhook: App Secret not configured');
			throw new UnauthorizedException('App secret not configured');
		}
		if (!rawBody || (Buffer.isBuffer(rawBody) && rawBody.length === 0)) {
			this.logger.warn(
				'Rejected Meta webhook: missing rawBody (signature cannot be verified). Restart API with Nest rawBody enabled.',
			);
			await this.activity.log('webhook.raw_body_missing', null, {});
			throw new UnauthorizedException('Missing raw request body for signature verification');
		}
		const valid = this.crypto.verifyMetaSignature(
			rawBody,
			signatureHeader,
			runtime.secrets.appSecret,
		);
		if (!valid) {
			this.logger.warn('Rejected Meta webhook: invalid signature (check App Secret)');
			await this.activity.log('webhook.signature_invalid', null, {
				hasSignature: Boolean(signatureHeader),
			});
			throw new UnauthorizedException('Invalid Meta signature');
		}

		if (!runtime.config.enabled) {
			this.logger.warn('Meta WhatsApp disabled — acknowledging webhook without processing');
			return { ok: true, processed: 0, skipped: true };
		}

		let processed = 0;
		let inbound = 0;
		let statuses = 0;
		const entries = Array.isArray(payload?.entry) ? payload.entry : [];
		for (const entry of entries) {
			const changes = Array.isArray(entry?.changes) ? entry.changes : [];
			for (const change of changes) {
				if (change?.field !== 'messages') continue;
				const value = change.value || {};
				const statusCount = await this.processStatuses(value.statuses);
				const messageCount = await this.processMessages(value.messages, value.contacts);
				statuses += statusCount;
				inbound += messageCount;
				processed += statusCount + messageCount;
			}
		}

		if (inbound > 0 || statuses > 0) {
			this.logger.log(
				`Meta webhook processed inbound=${inbound} statusUpdates=${statuses}`,
			);
		} else {
			this.logger.debug('Meta webhook acknowledged with no message/status items');
		}

		return { ok: true, processed, inbound, statuses };
	}

	private async processStatuses(statuses: any[] | undefined) {
		if (!Array.isArray(statuses) || !statuses.length) return 0;
		let count = 0;
		for (const status of statuses) {
			const wamid = status?.id;
			if (!wamid) continue;
			const message = await this.messageRepo.findOne({ where: { wamid } });
			if (!message) continue;
			const mapped = this.mapStatus(status.status);
			if (mapped) message.status = mapped;
			if (status.errors?.[0]) {
				message.errorCode = String(status.errors[0].code || '');
				message.errorMessage = status.errors[0].title || status.errors[0].message || null;
				message.status = MetaWaMessageStatus.FAILED;
			}

			const pricing = status.pricing || status.conversation?.origin || null;
			if (status.pricing) {
				const category = String(
					status.pricing.category || status.pricing.pricing_category || '',
				)
					.toUpperCase()
					.trim();
				const pricingType = String(status.pricing.type || status.pricing.pricing_type || '')
					.toUpperCase()
					.trim();
				const pricingModel = String(
					status.pricing.pricing_model || status.pricing.model || '',
				)
					.toUpperCase()
					.trim();
				if (category) message.pricingCategory = category;
				if (pricingType) message.pricingType = pricingType;
				if (pricingModel) message.pricingModel = pricingModel;
				if (typeof status.pricing.billable === 'boolean') {
					message.billable = status.pricing.billable;
				} else if (pricingType) {
					message.billable = pricingType === 'REGULAR';
				}
			} else if (pricing && typeof pricing === 'object') {
				const category = String(pricing.type || pricing.category || '')
					.toUpperCase()
					.trim();
				if (category) message.pricingCategory = category;
			}

			message.rawPayload = { ...(message.rawPayload || {}), status };
			await this.messageRepo.save(message);
			count += 1;
		}
		return count;
	}

	private async processMessages(messages: any[] | undefined, contacts: any[] | undefined) {
		if (!Array.isArray(messages) || !messages.length) return 0;
		const contactByWa = new Map<string, string>();
		for (const c of contacts || []) {
			const id = normalizeWaId(c?.wa_id || c?.waId);
			const name = c?.profile?.name;
			if (id && name) contactByWa.set(id, name);
		}
		let count = 0;

		for (const msg of messages) {
			try {
				const waId = normalizeWaId(msg.from);
				const wamid = msg.id;
				if (!waId || !wamid) {
					this.logger.warn(
						`Skipping inbound Meta message: invalid from/id from=${msg?.from} id=${wamid}`,
					);
					continue;
				}

				const existing = await this.messageRepo.findOne({ where: { wamid } });
				if (existing) continue;

				const lead = await this.leadRepo
					.createQueryBuilder('l')
					.where(
						`regexp_replace(COALESCE(l.phone, ''), '\\D', '', 'g') IN (:...candidates)`,
						{
							candidates: this.phoneLookupCandidates(waId),
						},
					)
					.getOne()
					.catch(() => null);
				const contactName = contactByWa.get(waId) || contacts?.[0]?.profile?.name || null;
				const conversation = await this.conversations.findOrCreateByWaId({
					waId,
					leadId: lead?.id || null,
					displayName: contactName || lead?.businessName || waId,
					businessName: lead?.businessName || null,
				});

				const parsed = this.parseInboundMessage(msg);
				const row = this.messageRepo.create({
					conversationId: conversation.id,
					direction: MetaWaMessageDirection.INBOUND,
					messageType: parsed.type,
					body: parsed.body,
					wamid,
					status: MetaWaMessageStatus.RECEIVED,
					mediaId: parsed.mediaId,
					mediaMimeType: parsed.mimeType,
					mediaFileName: parsed.fileName,
					rawPayload: msg,
					leadId: conversation.leadId,
					providerTimestamp: msg.timestamp
						? new Date(Number(msg.timestamp) * 1000)
						: new Date(),
				});
				await this.messageRepo.save(row);
				await this.conversations.touchConversation(conversation, parsed.preview, {
					inbound: true,
					bumpUnread: true,
				});
				count += 1;
			} catch (err) {
				this.logger.warn(
					`Failed to persist inbound Meta message ${msg?.id}: ${
						err instanceof Error ? err.message : err
					}`,
				);
			}
		}

		if (count > 0) {
			await this.activity.log('webhook.messages_received', null, { count });
		}
		return count;
	}

	/** Match leads saved as local EG 01… or E.164 201… */
	private phoneLookupCandidates(waId: string): string[] {
		const out = new Set<string>([waId]);
		if (waId.startsWith('20') && waId.length >= 11) {
			out.add(`0${waId.slice(2)}`);
		}
		if (waId.startsWith('0') && waId.length >= 10) {
			out.add(`20${waId.slice(1)}`);
		}
		return [...out];
	}

	private parseInboundMessage(msg: any) {
		const type = String(msg.type || 'text');
		if (type === 'text') {
			const body = msg.text?.body || '';
			return { type, body, preview: body, mediaId: null, mimeType: null, fileName: null };
		}
		if (type === 'video') {
			return {
				type,
				body: msg.video?.caption || '',
				preview: msg.video?.caption || 'Video',
				mediaId: msg.video?.id || null,
				mimeType: msg.video?.mime_type || null,
				fileName: null,
			};
		}
		if (type === 'sticker') {
			return {
				type: 'sticker',
				body: '',
				preview: 'Sticker',
				mediaId: msg.sticker?.id || null,
				mimeType: msg.sticker?.mime_type || 'image/webp',
				fileName: null,
			};
		}
		if (type === 'image') {
			return {
				type,
				body: msg.image?.caption || '',
				preview: msg.image?.caption || 'Photo',
				mediaId: msg.image?.id || null,
				mimeType: msg.image?.mime_type || null,
				fileName: null,
			};
		}
		if (type === 'audio' || type === 'voice') {
			const isVoice = type === 'voice' || Boolean(msg.audio?.voice);
			return {
				type: isVoice ? 'voice' : 'audio',
				body: '',
				preview: isVoice ? 'Voice message' : 'Audio',
				mediaId: msg.audio?.id || null,
				mimeType: msg.audio?.mime_type || null,
				fileName: null,
			};
		}
		if (type === 'document') {
			const name = msg.document?.filename || 'document';
			return {
				type,
				body: msg.document?.caption || name,
				preview: name,
				mediaId: msg.document?.id || null,
				mimeType: msg.document?.mime_type || null,
				fileName: name,
			};
		}
		if (type === 'reaction') {
			const emoji = msg.reaction?.emoji || '👍';
			return {
				type: 'reaction',
				body: emoji,
				preview: `Reacted ${emoji}`,
				mediaId: null,
				mimeType: null,
				fileName: null,
			};
		}
		if (type === 'location') {
			const name = msg.location?.name || msg.location?.address || 'Location';
			return {
				type: 'location',
				body: name,
				preview: name,
				mediaId: null,
				mimeType: null,
				fileName: null,
			};
		}
		if (type === 'contacts') {
			const name = msg.contacts?.[0]?.name?.formatted_name || 'Contact';
			return {
				type: 'contacts',
				body: name,
				preview: name,
				mediaId: null,
				mimeType: null,
				fileName: null,
			};
		}
		if (type === 'unsupported' || type === 'system') {
			return {
				type: 'unsupported',
				body: '',
				preview: 'Unsupported message',
				mediaId: null,
				mimeType: null,
				fileName: null,
			};
		}
		if (type === 'button') {
			const body = msg.button?.text || msg.button?.payload || 'Button reply';
			return { type, body, preview: body, mediaId: null, mimeType: null, fileName: null };
		}
		if (type === 'interactive') {
			const body =
				msg.interactive?.button_reply?.title ||
				msg.interactive?.list_reply?.title ||
				'Interactive reply';
			return { type, body, preview: body, mediaId: null, mimeType: null, fileName: null };
		}
		return {
			type,
			body: '',
			preview: type ? String(type) : 'Message',
			mediaId: null,
			mimeType: null,
			fileName: null,
		};
	}

	private mapStatus(status: string | undefined): MetaWaMessageStatus | null {
		switch (String(status || '').toLowerCase()) {
			case 'sent':
				return MetaWaMessageStatus.SENT;
			case 'delivered':
				return MetaWaMessageStatus.DELIVERED;
			case 'read':
				return MetaWaMessageStatus.READ;
			case 'failed':
				return MetaWaMessageStatus.FAILED;
			default:
				return null;
		}
	}
}
