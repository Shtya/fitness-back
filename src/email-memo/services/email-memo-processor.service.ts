import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
	EmailMemoAiMemo,
	EmailMemoDeliveryStatus,
	EmailMemoGmailConnection,
	EmailMemoGmailMessage,
	EmailMemoMessageStatus,
	EmailMemoNotificationSettings,
	EmailMemoProcessingLog,
	EmailMemoUsageDaily,
	EmailMemoWhatsAppMessage,
} from '../entities/email-memo.entity';
import { EmailMemoAiService } from './email-memo-ai.service';
import { EmailMemoGmailService } from './email-memo-gmail.service';
import { EmailMemoSettingsService } from './email-memo-settings.service';
import { EmailMemoWhatsAppService } from './email-memo-whatsapp.service';
import { EmailMemoGateway } from '../email-memo.gateway';
import {
	ExtractedGmailMessage,
	isBlockedGmailMessage,
	looksLikeNewsletter,
} from '../utils/email-memo.utils';

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

function utcDay(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

function matchList(values: string[] = [], haystack: string) {
	const text = haystack.toLowerCase();
	return values.some((value) => value && text.includes(String(value).toLowerCase()));
}

@Injectable()
export class EmailMemoProcessorService {
	private readonly logger = new Logger(EmailMemoProcessorService.name);
	private readonly inflight = new Set<string>();
	private readonly pending: Array<{ connectionId: string; messageId: string }> = [];
	private active = 0;
	private readonly concurrency = 2;

	constructor(
		private readonly gmail: EmailMemoGmailService,
		private readonly settings: EmailMemoSettingsService,
		private readonly ai: EmailMemoAiService,
		private readonly whatsapp: EmailMemoWhatsAppService,
		private readonly gateway: EmailMemoGateway,
		@InjectRepository(EmailMemoGmailMessage)
		private readonly messages: Repository<EmailMemoGmailMessage>,
		@InjectRepository(EmailMemoAiMemo)
		private readonly memos: Repository<EmailMemoAiMemo>,
		@InjectRepository(EmailMemoWhatsAppMessage)
		private readonly waMessages: Repository<EmailMemoWhatsAppMessage>,
		@InjectRepository(EmailMemoProcessingLog)
		private readonly logs: Repository<EmailMemoProcessingLog>,
		@InjectRepository(EmailMemoUsageDaily)
		private readonly usage: Repository<EmailMemoUsageDaily>,
	) {}

	enqueueHistory(connectionId: string, gmailMessageId: string) {
		const key = `${connectionId}:${gmailMessageId}`;
		if (this.inflight.has(key)) return;
		this.pending.push({ connectionId, messageId: gmailMessageId });
		this.drain();
	}

	async processConnection(connection: EmailMemoGmailConnection) {
		const { messageIds, newHistoryId } = await this.gmail.listHistoryMessageIds(connection);
		for (const messageId of messageIds) this.enqueueHistory(connection.id, messageId);
		await this.gmail.persistHistoryId(connection, newHistoryId);
		return { queued: messageIds.length };
	}

	async handlePubSub(emailAddress: string, historyId?: string) {
		const connection = await this.gmail.findByAddress(emailAddress);
		if (!connection) return { ok: true, ignored: true };
		return this.processConnection(connection);
	}

	private drain() {
		while (this.active < this.concurrency && this.pending.length) {
			const job = this.pending.shift()!;
			this.active += 1;
			this.runJob(job.connectionId, job.messageId)
				.catch((error) => {
					this.logger.error(
						`Email memo job failed: ${error instanceof Error ? error.message : error}`,
					);
				})
				.finally(() => {
					this.active -= 1;
					this.drain();
				});
		}
	}

	private async runJob(connectionId: string, gmailMessageId: string) {
		const key = `${connectionId}:${gmailMessageId}`;
		if (this.inflight.has(key)) return;
		this.inflight.add(key);
		try {
			const connection = await this.gmail.getConnectionById(connectionId);
			if (!connection) return;
			await this.ingestMessage(connection, gmailMessageId);
		} finally {
			this.inflight.delete(key);
		}
	}

	private async ingestMessage(connection: EmailMemoGmailConnection, gmailMessageId: string) {
		const existing = await this.messages.findOne({
			where: { gmailConnectionId: connection.id, gmailMessageId },
		});
		if (existing && existing.status !== EmailMemoMessageStatus.FAILED) return;

		let extracted: ExtractedGmailMessage;
		try {
			extracted = await this.gmail.getMessage(connection, gmailMessageId);
		} catch (error) {
			await this.log(connection.userId, null, 'fetch', 'error', String(error));
			return;
		}

		if (isBlockedGmailMessage(extracted.labelIds)) {
			return;
		}

		const settings = await this.settings.getOrCreate(connection.userId);
		const skip = this.filterReason(extracted, settings, connection);
		let row = existing;
		if (!row) {
			try {
				row = await this.messages.save(
					this.messages.create({
						userId: connection.userId,
						gmailConnectionId: connection.id,
						gmailMessageId: extracted.gmailMessageId,
						threadId: extracted.threadId,
						senderName: extracted.senderName,
						senderEmail: extracted.senderEmail,
						subject: extracted.subject,
						snippet: extracted.snippet,
						bodyText: extracted.bodyText,
						gmailUrl: extracted.gmailUrl,
						labelIds: extracted.labelIds,
						receivedAt: extracted.receivedAt,
						status: skip ? EmailMemoMessageStatus.SKIPPED : EmailMemoMessageStatus.RECEIVED,
						skipReason: skip,
					}),
				);
			} catch (error: any) {
				if (String(error?.code) === '23505') return;
				throw error;
			}
		} else {
			row.bodyText = extracted.bodyText;
			row.subject = extracted.subject;
			row.senderName = extracted.senderName;
			row.senderEmail = extracted.senderEmail;
			row.labelIds = extracted.labelIds;
			await this.messages.save(row);
		}

		this.gateway.emitToUser(connection.userId, 'email-memo:message', {
			id: row.id,
			status: row.status,
			subject: row.subject,
		});

		if (skip) {
			await this.log(connection.userId, row.id, 'filter', 'info', skip);
			return;
		}

		await this.processPipeline(row, settings);
	}

	private filterReason(
		extracted: ExtractedGmailMessage,
		settings: EmailMemoNotificationSettings,
		connection: EmailMemoGmailConnection,
	): string | null {
		if (
			connection.connectedAt &&
			extracted.receivedAt &&
			extracted.receivedAt.getTime() < connection.connectedAt.getTime() - 5000
		) {
			return 'old_email';
		}
		const labels = extracted.labelIds || [];
		if (settings.onlyUnread && !extracted.unread) return 'already_read';
		if (settings.ignorePromotional && labels.includes('CATEGORY_PROMOTIONS')) {
			return 'promotional';
		}
		if (settings.ignoreNewsletters && looksLikeNewsletter(extracted)) return 'newsletter';
		const requiredLabels = (settings.gmailLabels || []).filter(Boolean);
		if (requiredLabels.length && !requiredLabels.some((label) => labels.includes(label))) {
			return 'label';
		}
		const blob = `${extracted.senderEmail} ${extracted.senderName} ${extracted.subject}`.toLowerCase();
		const senderEmail = String(extracted.senderEmail || '').trim().toLowerCase();
		if ((settings.senderExclude || []).some((value) => {
			const needle = String(value || '').trim().toLowerCase();
			if (!needle) return false;
			return senderEmail === needle || blob.includes(needle);
		})) return 'excluded_sender';
		if (settings.senderInclude?.length && !matchList(settings.senderInclude, blob)) {
			return 'sender_mismatch';
		}
		if (settings.subjectInclude?.length && !matchList(settings.subjectInclude, extracted.subject)) {
			return 'subject_mismatch';
		}
		if (settings.gmailQuery) {
			if (!this.matchesQuery(settings.gmailQuery, extracted)) return 'query_mismatch';
		}
		if (extracted.senderEmail && extracted.senderEmail === connection.gmailAddress) {
			return 'self_sent';
		}
		return null;
	}

	private matchesQuery(query: string, extracted: ExtractedGmailMessage) {
		const raw = query.trim();
		if (!raw) return true;
		const from = raw.match(/from:(\S+)/i)?.[1]?.replace(/"/g, '').toLowerCase();
		const subject = raw.match(/subject:(\S+)/i)?.[1]?.replace(/"/g, '').toLowerCase();
		if (from && !`${extracted.senderEmail} ${extracted.senderName}`.toLowerCase().includes(from)) {
			return false;
		}
		if (subject && !extracted.subject.toLowerCase().includes(subject)) return false;
		return true;
	}

	async processPipeline(row: EmailMemoGmailMessage, settings?: EmailMemoNotificationSettings) {
		const cfg = settings || (await this.settings.getOrCreate(row.userId));
		row.status = EmailMemoMessageStatus.PROCESSING;
		row.attemptCount += 1;
		row.errorMessage = null;
		await this.messages.save(row);

		try {
			let memo = await this.memos.findOne({ where: { gmailMessageId: row.id } });
			if (!memo) {
				const generated = await this.ai.generateMemo({
					settings: cfg,
					userId: row.userId,
					senderName: row.senderName || '',
					senderEmail: row.senderEmail || '',
					subject: row.subject || '',
					bodyText: row.bodyText || '',
					receivedAt: row.receivedAt,
				});
				await this.bumpUsage(row.userId, 'ai_requests');
				await this.bumpUsage(row.userId, 'emails_processed');
				const inbox = (await this.gmail.getConnectionById(row.gmailConnectionId))?.gmailAddress || null;
				const formatted = this.ai.formatWhatsApp({
					settings: cfg,
					fromLabel: generated.fromLabel,
					subjectLabel: generated.subjectLabel,
					memoText: generated.memoText,
					actionText: generated.actionText,
					deadline: generated.deadline,
					gmailUrl: row.gmailUrl,
					inboxLabel: inbox,
				});
				memo = await this.memos.save(
					this.memos.create({
						userId: row.userId,
						gmailMessageId: row.id,
						provider: generated.provider,
						model: generated.model,
						memoText: generated.memoText,
						actionText: generated.actionText,
						priority: generated.priority,
						deadline: generated.deadline,
						formattedMessage: formatted,
						promptVersion: 'v2',
					}),
				);
			}

			row.status = EmailMemoMessageStatus.AI_COMPLETED;
			await this.messages.save(row);
			this.gateway.emitToUser(row.userId, 'email-memo:message', {
				id: row.id,
				status: row.status,
			});

			const minRank = PRIORITY_RANK[cfg.minPriority] || 1;
			const memoRank = PRIORITY_RANK[memo.priority || 'medium'] || 2;
			if (memoRank < minRank || (cfg.onlyImportant && (memo.priority || '') !== 'high')) {
				row.status = EmailMemoMessageStatus.SKIPPED;
				row.skipReason = 'priority';
				row.processedAt = new Date();
				await this.messages.save(row);
				return;
			}

			if (!cfg.whatsappEnabled) {
				row.processedAt = new Date();
				await this.messages.save(row);
				return;
			}

			if (cfg.notificationMode !== 'immediate') {
				row.sendAfter =
					cfg.notificationMode === 'batch30'
						? new Date(Date.now() + 30 * 60 * 1000)
						: this.nextDigestTime();
				await this.messages.save(row);
				return;
			}

			await this.deliver(row, memo, cfg);
		} catch (error) {
			const wait = Math.min(15 * 60 * 1000, 2000 * 2 ** Math.min(row.attemptCount, 6));
			row.status = EmailMemoMessageStatus.FAILED;
			row.errorMessage = error instanceof Error ? error.message : String(error);
			row.nextRetryAt = new Date(Date.now() + wait);
			await this.messages.save(row);
			await this.log(row.userId, row.id, 'pipeline', 'error', row.errorMessage);
			this.gateway.emitToUser(row.userId, 'email-memo:message', {
				id: row.id,
				status: row.status,
				error: row.errorMessage,
			});
		}
	}

	async deliver(
		row: EmailMemoGmailMessage,
		memo: EmailMemoAiMemo,
		settings: EmailMemoNotificationSettings,
	) {
		row.status = EmailMemoMessageStatus.SENDING;
		await this.messages.save(row);
		const chatId = await this.whatsapp.resolveTargetChat(row.userId, settings.targetChatId);
		const linked = await this.whatsapp.getConnection(row.userId);
		if (!linked.connected || !chatId) {
			throw new Error('WhatsApp is not connected');
		}
		const sent = await this.whatsapp.sendText(row.userId, chatId, memo.formattedMessage);
		const wa = await this.waMessages.save(
			this.waMessages.create({
				userId: row.userId,
				gmailMessageId: row.id,
				aiMemoId: memo.id,
				chatId,
				providerMessageId: sent.id,
				body: memo.formattedMessage,
				status: EmailMemoDeliveryStatus.SENT,
				sentAt: new Date(),
			}),
		);
		row.status = EmailMemoMessageStatus.SENT;
		row.processedAt = new Date();
		row.errorMessage = null;
		row.nextRetryAt = null;
		await this.messages.save(row);
		await this.bumpUsage(row.userId, 'whatsapp_sent');
		await this.log(row.userId, row.id, 'whatsapp', 'info', 'Memo sent');
		this.gateway.emitToUser(row.userId, 'email-memo:message', {
			id: row.id,
			status: row.status,
			whatsappMessageId: wa.id,
		});
	}

	async retryDue() {
		const due = await this.messages.find({
			where: [
				{ status: EmailMemoMessageStatus.FAILED },
				{ status: EmailMemoMessageStatus.AI_COMPLETED },
			],
			order: { updatedAt: 'ASC' },
			take: 20,
		});
		for (const row of due) {
			if (row.nextRetryAt && row.nextRetryAt.getTime() > Date.now()) continue;
			if (row.sendAfter && row.sendAfter.getTime() > Date.now()) continue;
			const settings = await this.settings.getOrCreate(row.userId);
			try {
				if (row.status === EmailMemoMessageStatus.AI_COMPLETED) {
					const memo = await this.memos.findOne({ where: { gmailMessageId: row.id } });
					if (memo) await this.deliver(row, memo, settings);
				} else {
					await this.processPipeline(row, settings);
				}
			} catch (error) {
				row.attemptCount += 1;
				row.errorMessage = error instanceof Error ? error.message : String(error);
				row.nextRetryAt = new Date(Date.now() + Math.min(15 * 60 * 1000, 2000 * 2 ** row.attemptCount));
				await this.messages.save(row);
			}
		}
	}

	async sendDueBatches() {
		const due = await this.messages.find({
			where: { status: EmailMemoMessageStatus.AI_COMPLETED },
			take: 50,
		});
		const now = Date.now();
		const grouped = new Map<string, EmailMemoGmailMessage[]>();
		for (const row of due) {
			if (!row.sendAfter || row.sendAfter.getTime() > now) continue;
			const list = grouped.get(row.userId) || [];
			list.push(row);
			grouped.set(row.userId, list);
		}
		for (const [userId, rows] of grouped) {
			const settings = await this.settings.getOrCreate(userId);
			if (settings.notificationMode === 'immediate') continue;
			const memoLines: string[] = ['📧 Email Memo Digest', ''];
			for (const row of rows) {
				const memo = await this.memos.findOne({ where: { gmailMessageId: row.id } });
				if (!memo) continue;
				memoLines.push(memo.formattedMessage, '');
			}
			try {
				const chatId = await this.whatsapp.resolveTargetChat(userId, settings.targetChatId);
				await this.whatsapp.sendText(userId, chatId, memoLines.join('\n').trim());
				for (const row of rows) {
					row.status = EmailMemoMessageStatus.SENT;
					row.processedAt = new Date();
					await this.messages.save(row);
				}
				await this.bumpUsage(userId, 'whatsapp_sent');
			} catch (error) {
				this.logger.warn(`Digest send failed: ${error instanceof Error ? error.message : error}`);
			}
		}
	}

	async usageToday(userId: string) {
		const row = await this.usage.findOne({ where: { userId, day: utcDay() } });
		return {
			emailsProcessedToday: row?.emailsProcessed || 0,
			aiRequestsToday: row?.aiRequests || 0,
			whatsappSentToday: row?.whatsappSent || 0,
		};
	}

	private nextDigestTime() {
		const now = new Date();
		const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
		if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
		return next;
	}

	private async bumpUsage(userId: string, field: 'emails_processed' | 'ai_requests' | 'whatsapp_sent') {
		const day = utcDay();
		let row = await this.usage.findOne({ where: { userId, day } });
		if (!row) row = this.usage.create({ userId, day });
		if (field === 'emails_processed') row.emailsProcessed += 1;
		if (field === 'ai_requests') row.aiRequests += 1;
		if (field === 'whatsapp_sent') row.whatsappSent += 1;
		await this.usage.save(row);
	}

	private async log(
		userId: string,
		gmailMessageId: string | null,
		stage: string,
		level: string,
		message: string,
		meta?: Record<string, unknown>,
	) {
		await this.logs.save(
			this.logs.create({
				userId,
				gmailMessageId,
				stage,
				level,
				message: String(message).slice(0, 2000),
				meta: meta || null,
			}),
		);
	}
}
