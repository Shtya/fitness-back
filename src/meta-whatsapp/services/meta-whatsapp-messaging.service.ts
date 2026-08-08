import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FitnessLead } from '../../fitness-leads/entities/fitness-leads.entity';
import {
	MetaWaMessageDirection,
	MetaWaMessageStatus,
	MetaWhatsAppMessage,
} from '../entities/meta-whatsapp.entity';
import {
	SendMetaTemplateDto,
	SendMetaTextDto,
} from '../dto/meta-whatsapp.dto';
import {
	isWithinCustomerCareWindow,
	normalizeWaId,
} from './meta-whatsapp-crypto.service';
import { MetaWhatsAppCloudApiService } from './meta-whatsapp-cloud-api.service';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';
import { MetaWhatsAppConversationsService } from './meta-whatsapp-conversations.service';
import { MetaWhatsAppActivityService } from './meta-whatsapp-activity.service';
import { MetaWhatsAppMediaService } from './meta-whatsapp-media.service';

const URL_BUTTON_PARAM_SAFE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;

/** Meta #132018 — dynamic URL button params must keep the final URL valid. */
export function assertValidTemplateUrlButtonParams(
	templateComponents: any[] | null | undefined,
	sendComponents?: any[] | null,
) {
	const send = Array.isArray(sendComponents) ? sendComponents : [];
	const buttonSends = send.filter(
		(c) =>
			String(c?.type || '').toLowerCase() === 'button' &&
			String(c?.sub_type || '').toLowerCase() === 'url',
	);
	if (!buttonSends.length) return;

	const tplButtons =
		(Array.isArray(templateComponents)
			? templateComponents.find((c) => String(c?.type || '').toUpperCase() === 'BUTTONS')
					?.buttons
			: null) || [];

	for (const btnSend of buttonSends) {
		const idx = Number(btnSend.index ?? 0);
		const param = String(btnSend?.parameters?.[0]?.text || '').trim();
		if (!param) {
			throw new BadRequestException('URL button parameter is required');
		}
		if (/\s/.test(param) || /[^\x00-\x7F]/.test(param) || !URL_BUTTON_PARAM_SAFE.test(param)) {
			throw new BadRequestException(
				'URL button parameter is invalid. Use only Latin letters, numbers, and URL-safe characters (e.g. demo or user/123) — no spaces or Arabic text. (Meta #132018)',
			);
		}
		const urlTemplate = String(tplButtons[idx]?.url || '');
		if (urlTemplate.includes('{{')) {
			const filled = urlTemplate.replace(/\{\{\s*[\w]+\s*\}\}/g, () => param);
			try {
				const u = new URL(filled);
				if (!/^https?:$/i.test(u.protocol)) {
					throw new Error('bad protocol');
				}
			} catch {
				throw new BadRequestException(
					`URL button parameter generates an invalid URL. Check Button ${idx + 1} value. (Meta #132018)`,
				);
			}
		}
	}
}

/** Build readable template text from Meta template definition + send parameters. */
export function renderFilledTemplateText(
	templateComponents: any[] | null | undefined,
	sendComponents?: any[] | null,
): string | null {
	const comps = Array.isArray(templateComponents) ? templateComponents : [];
	const header = comps.find(c => String(c?.type || '').toUpperCase() === 'HEADER');
	const body = comps.find(c => String(c?.type || '').toUpperCase() === 'BODY');
	const footer = comps.find(c => String(c?.type || '').toUpperCase() === 'FOOTER');

	const send = Array.isArray(sendComponents) ? sendComponents : [];
	const sendHeader = send.find(c => String(c?.type || '').toLowerCase() === 'header');
	const sendBody = send.find(c => String(c?.type || '').toLowerCase() === 'body');

	const fill = (text: string | undefined, params: any[] | undefined) => {
		if (!text) return '';
		const list = Array.isArray(params) ? params : [];
		return String(text)
			.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
				const idx = Number(n) - 1;
				return list[idx]?.text != null ? String(list[idx].text) : `{{${n}}}`;
			})
			.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (_m, name) => {
				const hit = list.find(p => p?.parameter_name === name);
				return hit?.text != null ? String(hit.text) : `{{${name}}}`;
			});
	};

	const parts = [
		fill(header?.text, sendHeader?.parameters),
		fill(body?.text, sendBody?.parameters),
		footer?.text ? String(footer.text) : '',
	].filter(Boolean);

	if (parts.length) return parts.join('\n');
	// Fallback: join any text params if definition missing
	const bodyParams = sendBody?.parameters || [];
	if (bodyParams.length) return bodyParams.map((p: any) => p?.text).filter(Boolean).join(' ');
	return null;
}

/** Resolve template CTA / quick-reply buttons with dynamic URL params filled. */
export function resolveTemplateButtons(
	templateComponents: any[] | null | undefined,
	sendComponents?: any[] | null,
): Array<{ type: string; text: string; url?: string; phone_number?: string }> {
	const comps = Array.isArray(templateComponents) ? templateComponents : [];
	const buttonBlock = comps.find((c) => String(c?.type || '').toUpperCase() === 'BUTTONS');
	const buttons = Array.isArray(buttonBlock?.buttons) ? buttonBlock.buttons : [];
	if (!buttons.length) return [];

	const send = Array.isArray(sendComponents) ? sendComponents : [];
	const urlSends = send.filter(
		(c) =>
			String(c?.type || '').toLowerCase() === 'button' &&
			String(c?.sub_type || '').toLowerCase() === 'url',
	);

	return buttons.map((btn: any, index: number) => {
		const type = String(btn?.type || 'QUICK_REPLY').toUpperCase();
		const text = String(btn?.text || '').trim();
		let url = String(btn?.url || '').trim();
		const phone_number = String(btn?.phone_number || '').trim();

		if (type === 'URL' && url.includes('{{')) {
			const sendBtn =
				urlSends.find((s) => Number(s.index ?? -1) === index) ||
				urlSends.find((s) => Number(s.index ?? 0) === index) ||
				urlSends[0];
			const param = String(sendBtn?.parameters?.[0]?.text || '').trim();
			if (param) {
				url = url.replace(/\{\{\s*[\w]+\s*\}\}/g, () => param);
			}
		}

		return {
			type,
			text,
			...(url ? { url } : {}),
			...(phone_number ? { phone_number } : {}),
		};
	});
}

/** Normalize stored templateComponents (legacy array or v2 object). */
export function unwrapTemplateSendComponents(stored: any): any[] {
	if (Array.isArray(stored)) return stored;
	if (stored && Array.isArray(stored.send)) return stored.send;
	if (stored && Array.isArray(stored.parameters)) return stored.parameters;
	return [];
}

export function unwrapStoredTemplateButtons(stored: any) {
	if (stored && Array.isArray(stored.buttons)) return stored.buttons;
	return [];
}

@Injectable()
export class MetaWhatsAppMessagingService {
	constructor(
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		@InjectRepository(FitnessLead)
		private readonly leadRepo: Repository<FitnessLead>,
		private readonly configService: MetaWhatsAppConfigService,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
		private readonly conversations: MetaWhatsAppConversationsService,
		private readonly activity: MetaWhatsAppActivityService,
		private readonly media: MetaWhatsAppMediaService,
	) {}

	async sendText(userId: string, dto: SendMetaTextDto) {
		const text = String(dto.text || '').trim();
		if (!text) throw new BadRequestException('Message text is required');

		const { conversation, lead } = await this.resolveTarget(dto);
		await this.conversations.syncLastInboundAt(conversation);
		const care = await this.conversations.resolveCustomerCareWindow(conversation.id, conversation);
		this.assertFreeformAllowed(care.lastInboundAt);

		const runtime = await this.configService.requireRuntime({ requireEnabled: true });
		const message = this.messageRepo.create({
			conversationId: conversation.id,
			direction: MetaWaMessageDirection.OUTBOUND,
			messageType: 'text',
			body: text,
			status: MetaWaMessageStatus.QUEUED,
			sentBy: userId || null,
			leadId: lead?.id || conversation.leadId,
		});
		await this.messageRepo.save(message);

		try {
			const sent = await this.cloudApi.sendText(
				runtime.secrets.accessToken,
				runtime.config.phoneNumberId!,
				conversation.waId,
				text,
			);
			message.wamid = sent.wamid;
			message.status = MetaWaMessageStatus.SENT;
			message.rawPayload = sent.raw;
			await this.messageRepo.save(message);
			await this.conversations.touchConversation(conversation, text);
			await this.activity.log('message.sent.text', userId, {
				conversationId: conversation.id,
				wamid: sent.wamid,
			});
			return this.conversations.serializeMessage(message);
		} catch (error) {
			await this.failMessage(message, error);
		}
	}

	async sendTemplate(userId: string, dto: SendMetaTemplateDto) {
		const templateName = String(dto.templateName || '').trim();
		if (!templateName) throw new BadRequestException('Template name is required');
		const language = (dto.language || 'en').trim();

		const { conversation, lead } = await this.resolveTarget(dto);
		const runtime = await this.configService.requireRuntime({ requireEnabled: true });

		let previewBody = '';
		let templateDef: any = null;
		try {
			const templates = await this.configService.listTemplates();
			templateDef =
				templates.find(
					(t: any) =>
						t.name === templateName &&
						String(t.language || '') === language,
				) || templates.find((t: any) => t.name === templateName);
			previewBody = renderFilledTemplateText(templateDef?.components, dto.components) || '';
		} catch {
			previewBody = '';
		}
		assertValidTemplateUrlButtonParams(templateDef?.components, dto.components);
		if (!previewBody) {
			previewBody = renderFilledTemplateText(null, dto.components) || templateName;
		}

		const resolvedButtons = resolveTemplateButtons(templateDef?.components, dto.components);
		const message = this.messageRepo.create({
			conversationId: conversation.id,
			direction: MetaWaMessageDirection.OUTBOUND,
			messageType: 'template',
			body: previewBody,
			templateName,
			templateLanguage: language,
			templateComponents: {
				v: 2,
				send: dto.components || [],
				buttons: resolvedButtons,
			},
			status: MetaWaMessageStatus.QUEUED,
			sentBy: userId || null,
			leadId: lead?.id || conversation.leadId,
		});
		await this.messageRepo.save(message);

		try {
			const sent = await this.cloudApi.sendTemplate(
				runtime.secrets.accessToken,
				runtime.config.phoneNumberId!,
				conversation.waId,
				templateName,
				language,
				dto.components,
			);
			message.wamid = sent.wamid;
			message.status = MetaWaMessageStatus.SENT;
			message.rawPayload = sent.raw;
			await this.messageRepo.save(message);
			await this.conversations.touchConversation(conversation, previewBody);
			await this.activity.log('message.sent.template', userId, {
				conversationId: conversation.id,
				templateName,
				wamid: sent.wamid,
			});
			return this.conversations.serializeMessage(message);
		} catch (error) {
			await this.failMessage(message, error);
		}
	}

	async sendMediaFile(
		userId: string,
		input: {
			conversationId?: string;
			leadId?: string;
			phone?: string;
			caption?: string;
			buffer: Buffer;
			mimeType: string;
			fileName: string;
			asVoice?: boolean;
		},
	) {
		if (!input.buffer?.length) throw new BadRequestException('File is required');
		let mimeType = input.mimeType || 'application/octet-stream';
		let fileName = input.fileName;
		let buffer = input.buffer;

		if (input.asVoice || mimeType.startsWith('audio/')) {
			const prepared = await this.media.ensureMetaAudioBuffer(
				buffer,
				mimeType,
				fileName,
				Boolean(input.asVoice),
			);
			buffer = prepared.buffer;
			mimeType = prepared.mimeType;
			fileName = prepared.fileName;
		}

		const messageType = input.asVoice
			? 'voice'
			: this.media.guessMessageType(mimeType);

		const { conversation, lead } = await this.resolveTarget(input);
		await this.conversations.syncLastInboundAt(conversation);
		const care = await this.conversations.resolveCustomerCareWindow(conversation.id, conversation);
		this.assertFreeformAllowed(care.lastInboundAt);

		const runtime = await this.configService.requireRuntime({ requireEnabled: true });
		const message = this.messageRepo.create({
			conversationId: conversation.id,
			direction: MetaWaMessageDirection.OUTBOUND,
			messageType,
			body: input.caption || null,
			status: MetaWaMessageStatus.QUEUED,
			sentBy: userId || null,
			leadId: lead?.id || conversation.leadId,
			mediaMimeType: mimeType,
			mediaFileName: fileName,
		});
		await this.messageRepo.save(message);

		try {
			const saved = await this.media.saveLocalFile(
				message.id,
				buffer,
				mimeType,
				fileName,
			);
			message.mediaUrl = saved.relativePath;

			const uploaded = await this.cloudApi.uploadMedia(
				runtime.secrets.accessToken,
				runtime.config.phoneNumberId!,
				buffer,
				mimeType,
				fileName,
			);
			message.mediaId = uploaded.mediaId;

			let sent;
			if (messageType === 'image') {
				sent = await this.cloudApi.sendImageById(
					runtime.secrets.accessToken,
					runtime.config.phoneNumberId!,
					conversation.waId,
					uploaded.mediaId,
					input.caption,
				);
			} else if (messageType === 'video') {
				sent = await this.cloudApi.sendVideoById(
					runtime.secrets.accessToken,
					runtime.config.phoneNumberId!,
					conversation.waId,
					uploaded.mediaId,
					input.caption,
				);
			} else if (messageType === 'audio' || messageType === 'voice') {
				sent = await this.cloudApi.sendAudioById(
					runtime.secrets.accessToken,
					runtime.config.phoneNumberId!,
					conversation.waId,
					uploaded.mediaId,
				);
			} else {
				sent = await this.cloudApi.sendDocumentById(
					runtime.secrets.accessToken,
					runtime.config.phoneNumberId!,
					conversation.waId,
					uploaded.mediaId,
					input.fileName,
					input.caption,
				);
			}

			message.wamid = sent.wamid;
			message.status = MetaWaMessageStatus.SENT;
			message.rawPayload = sent.raw;
			await this.messageRepo.save(message);
			await this.conversations.touchConversation(
				conversation,
				input.caption ||
					(messageType === 'image'
						? 'Photo'
						: messageType === 'video'
							? 'Video'
							: messageType === 'voice' || messageType === 'audio'
								? 'Voice message'
								: fileName || 'Document'),
			);
			await this.activity.log('message.sent.media', userId, {
				conversationId: conversation.id,
				messageType,
				wamid: sent.wamid,
			});
			return this.conversations.serializeMessage(message);
		} catch (error) {
			await this.failMessage(message, error);
		}
	}

	private assertFreeformAllowed(lastInboundAt: Date | null | undefined) {
		if (!isWithinCustomerCareWindow(lastInboundAt)) {
			throw new BadRequestException({
				code: 'OUTSIDE_CUSTOMER_CARE_WINDOW',
				message:
					'Free-form messages are only allowed within 24 hours of the last customer message. Use an approved template instead.',
			});
		}
	}

	private async failMessage(message: MetaWhatsAppMessage, error: unknown): Promise<never> {
		message.status = MetaWaMessageStatus.FAILED;
		message.errorMessage = error instanceof Error ? error.message : 'Send failed';
		await this.messageRepo.save(message);
		throw error;
	}

	private async resolveTarget(dto: {
		conversationId?: string;
		leadId?: string;
		phone?: string;
	}) {
		let lead: FitnessLead | null = null;
		if (dto.leadId) {
			lead = await this.leadRepo.findOne({ where: { id: dto.leadId } });
			if (!lead) throw new NotFoundException('Lead not found');
		}

		if (dto.conversationId) {
			const conversationEntity = await this.conversations.findEntity(dto.conversationId);
			return { conversation: conversationEntity, lead };
		}

		const phone = normalizeWaId(dto.phone || lead?.phone);
		if (!phone) throw new BadRequestException('A valid phone number is required');

		const conversation = await this.conversations.findOrCreateByWaId({
			waId: phone,
			leadId: lead?.id || null,
			displayName: lead?.businessName || phone,
			businessName: lead?.businessName || null,
		});
		return { conversation, lead };
	}
}
