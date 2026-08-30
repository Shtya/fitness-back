import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailMemoNotificationSettings } from '../entities/email-memo.entity';
import { UpdateEmailMemoSettingsDto } from '../dto/email-memo.dto';
import { normalizeWhatsAppChatId } from '../utils/email-memo.utils';

const DEFAULTS: Partial<EmailMemoNotificationSettings> = {
	processAllIncoming: true,
	onlyUnread: false,
	ignorePromotional: true,
	ignoreNewsletters: true,
	gmailQuery: null,
	senderInclude: [],
	senderExclude: [],
	subjectInclude: [],
	gmailLabels: ['INBOX'],
	minPriority: 'low',
	memoLength: 'medium',
	includeSender: true,
	includeSubject: true,
	includeSummary: true,
	includeAction: true,
	includeDeadline: true,
	includeGmailLink: true,
	customInstructions: null,
	aiProvider: 'ai-free',
	aiModel: null,
	whatsappEnabled: true,
	onlyImportant: false,
	notificationMode: 'immediate',
	targetChatId: null,
	targetChatName: null,
	deliveryDestination: 'in_site',
	pollIntervalHours: 1,
};

@Injectable()
export class EmailMemoSettingsService {
	constructor(
		@InjectRepository(EmailMemoNotificationSettings)
		private readonly repo: Repository<EmailMemoNotificationSettings>,
	) {}

	async getOrCreate(userId: string) {
		let row = await this.repo.findOne({ where: { userId } });
		if (!row) {
			row = this.repo.create({ userId, ...DEFAULTS });
			row = await this.repo.save(row);
		}
		return row;
	}

	async update(userId: string, dto: UpdateEmailMemoSettingsDto) {
		const row = await this.getOrCreate(userId);
		const next: UpdateEmailMemoSettingsDto = { ...dto };
		if (next.targetChatId !== undefined) {
			next.targetChatId = normalizeWhatsAppChatId(next.targetChatId) || null;
		}
		Object.assign(row, next);
		return this.repo.save(row);
	}

	toPublic(row: EmailMemoNotificationSettings) {
		return {
			processAllIncoming: row.processAllIncoming,
			onlyUnread: row.onlyUnread,
			ignorePromotional: row.ignorePromotional,
			ignoreNewsletters: row.ignoreNewsletters,
			gmailQuery: row.gmailQuery,
			senderInclude: row.senderInclude || [],
			senderExclude: row.senderExclude || [],
			subjectInclude: row.subjectInclude || [],
			gmailLabels: row.gmailLabels || ['INBOX'],
			minPriority: row.minPriority,
			memoLength: row.memoLength,
			includeSender: row.includeSender,
			includeSubject: row.includeSubject,
			includeSummary: row.includeSummary,
			includeAction: row.includeAction,
			includeDeadline: row.includeDeadline,
			includeGmailLink: row.includeGmailLink,
			customInstructions: row.customInstructions,
			aiProvider: row.aiProvider,
			aiModel: row.aiModel,
			whatsappEnabled: row.whatsappEnabled,
			onlyImportant: row.onlyImportant,
			notificationMode: row.notificationMode,
			targetChatId: row.targetChatId,
			targetChatName: row.targetChatName,
			deliveryDestination: ['whatsapp', 'in_site', 'both'].includes(
				String(row.deliveryDestination || ''),
			)
				? row.deliveryDestination
				: 'in_site',
			pollIntervalHours: Math.min(24, Math.max(1, Number(row.pollIntervalHours) || 1)),
		};
	}
}
