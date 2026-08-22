import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
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
import { EmailMemoInSiteInboxService } from './email-memo-insite-inbox.service';
import { EmailMemoGateway } from '../email-memo.gateway';
import {
	ExtractedGmailMessage,
	isBlockedGmailMessage,
	isSenderExcluded,
	looksLikeNewsletter,
	startOfZonedDay,
	todaysInboxQuery,
} from '../utils/email-memo.utils';

const PRIORITY_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
const PROMPT_VERSION = 'v3';

function utcDay(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

function matchList(values: string[] = [], haystack: string) {
	const text = haystack.toLowerCase();
	return values.some((value) => value && text.includes(String(value).toLowerCase()));
}

function normalizeDeliveryDestination(value?: string | null) {
	const dest = String(value || 'whatsapp').trim().toLowerCase();
	if (dest === 'in_site' || dest === 'both' || dest === 'whatsapp') return dest;
	return 'whatsapp';
}

function wantsWhatsAppDelivery(settings: EmailMemoNotificationSettings, forceSend = false) {
	const dest = normalizeDeliveryDestination(settings.deliveryDestination);
	if (dest !== 'whatsapp' && dest !== 'both') return false;
	return Boolean(settings.whatsappEnabled || forceSend);
}

function wantsInSiteDelivery(settings: EmailMemoNotificationSettings) {
	const dest = normalizeDeliveryDestination(settings.deliveryDestination);
	return dest === 'in_site' || dest === 'both';
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
		private readonly inSiteInbox: EmailMemoInSiteInboxService,
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

	async importTodaysInbox(connection: EmailMemoGmailConnection) {
		let pageToken: string | undefined;
		let imported = 0;
		let pages = 0;
		do {
			const listed = await this.importInbox(connection, {
				max: 100,
				q: todaysInboxQuery(),
				process: false,
				pageToken,
			});
			imported += listed.imported;
			pageToken = listed.nextPageToken || undefined;
			pages += 1;
		} while (pageToken && pages < 5);
		return imported;
	}

	async flushToday(connection: EmailMemoGmailConnection) {
		await this.expireBeforeToday(connection);
		await this.importTodaysInbox(connection);

		const settings = await this.settings.getOrCreate(connection.userId);
		const rows = await this.listUnsentToday(connection.userId, {
			connectionId: connection.id,
			take: 150,
		});

		for (const row of rows) {
			if (row.status === EmailMemoMessageStatus.SENT) continue;
			const sender = String(row.senderEmail || '').trim().toLowerCase();
			if (sender && isSenderExcluded(sender, settings.senderExclude || [])) continue;
			if (row.skipReason === 'excluded_sender' || row.skipReason === 'self_sent') continue;
			try {
				await this.processPipeline(row, settings, { bypassDigest: true, forceSend: true });
			} catch (error) {
				this.logger.warn(
					`Today flush failed for ${row.id}: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		await this.gmail.touchSynced(connection);
		return { scanned: rows.length };
	}

	private async listUnsentToday(
		userId: string,
		opts: { connectionId?: string; take?: number } = {},
	) {
		const start = startOfZonedDay();
		const qb = this.messages
			.createQueryBuilder('row')
			.where('row.user_id = :userId', { userId })
			.andWhere('row.received_at >= :start', { start })
			.andWhere('row.status != :sent', { sent: EmailMemoMessageStatus.SENT })
			.andWhere('(row.skip_reason IS NULL OR row.skip_reason NOT IN (:...blocked))', {
				blocked: ['old_email', 'excluded_sender', 'self_sent'],
			})
			.orderBy('row.received_at', 'ASC')
			.take(Math.min(Math.max(Number(opts.take) || 150, 1), 150));
		if (opts.connectionId) {
			qb.andWhere('row.gmail_connection_id = :cid', { cid: opts.connectionId });
		}
		return qb.getMany();
	}

	async importInbox(
		connection: EmailMemoGmailConnection,
		opts: { pageToken?: string; max?: number; q?: string; process?: boolean } = {},
	) {
		const listed = await this.gmail.listInboxMessageIds(connection, {
			max: opts.max,
			pageToken: opts.pageToken,
			q: opts.q,
		});
		let imported = 0;
		const ids = listed.messageIds;
		let cursor = 0;
		const process = opts.process !== false;
		const workers = Array.from({ length: Math.min(3, Math.max(1, ids.length)) }, async () => {
			while (cursor < ids.length) {
				const messageId = ids[cursor];
				cursor += 1;
				try {
					await this.ingestMessage(connection, messageId, { process });
					imported += 1;
				} catch (error) {
					this.logger.warn(
						`Inbox import failed for ${messageId}: ${error instanceof Error ? error.message : error}`,
					);
				}
			}
		});
		await Promise.all(workers);
		return {
			imported,
			listed: ids.length,
			nextPageToken: listed.nextPageToken,
			hasMore: Boolean(listed.nextPageToken),
			inboxEstimate: listed.resultSizeEstimate,
		};
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

	private async ingestMessage(
		connection: EmailMemoGmailConnection,
		gmailMessageId: string,
		opts: { process?: boolean } = {},
	) {
		const existing = await this.messages.findOne({
			where: { gmailConnectionId: connection.id, gmailMessageId },
		});
		if (existing?.status === EmailMemoMessageStatus.SENT) return;
		if (
			existing &&
			existing.status !== EmailMemoMessageStatus.FAILED &&
			!(existing.status === EmailMemoMessageStatus.SKIPPED && existing.skipReason === 'old_email')
		) {
			return;
		}

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
			row.receivedAt = extracted.receivedAt;
			row.status = skip ? EmailMemoMessageStatus.SKIPPED : EmailMemoMessageStatus.RECEIVED;
			row.skipReason = skip;
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

		if (opts.process === false) return;

		await this.processPipeline(row, settings);
	}

	private filterReason(
		extracted: ExtractedGmailMessage,
		settings: EmailMemoNotificationSettings,
		connection: EmailMemoGmailConnection,
	): string | null {
		if (extracted.receivedAt && extracted.receivedAt.getTime() < startOfZonedDay().getTime()) {
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
		if (isSenderExcluded(senderEmail, settings.senderExclude || [])) return 'excluded_sender';
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

	async ensureMemo(row: EmailMemoGmailMessage, settings: EmailMemoNotificationSettings) {
		row.status = EmailMemoMessageStatus.PROCESSING;
		row.errorMessage = null;
		await this.messages.save(row);
		this.gateway.emitToUser(row.userId, 'email-memo:message', {
			id: row.id,
			status: row.status,
			subject: row.subject,
		});

		let memo = await this.memos.findOne({ where: { gmailMessageId: row.id } });
		const inbox = (await this.gmail.getConnectionById(row.gmailConnectionId))?.gmailAddress || null;
		const format = (generated?: {
			fromLabel: string;
			subjectLabel: string;
			memoText: string;
			actionText: string;
			deadline: string;
			arabicSummary?: string | null;
		}) =>
			this.ai.formatWhatsApp({
				settings,
				fromLabel: generated?.fromLabel || row.senderName || row.senderEmail || '',
				subjectLabel: generated?.subjectLabel || row.subject || '',
				memoText: generated?.memoText || memo?.memoText || '',
				actionText: generated?.actionText || memo?.actionText || 'No action required.',
				deadline: generated?.deadline ?? memo?.deadline,
				gmailUrl: row.gmailUrl,
				inboxLabel: inbox,
				arabicSummary: generated?.arabicSummary || memo?.arabicSummary,
				receivedAt: row.receivedAt,
			});

		if (!memo) {
			const generated = await this.ai.generateMemo({
				settings,
				userId: row.userId,
				senderName: row.senderName || '',
				senderEmail: row.senderEmail || '',
				subject: row.subject || '',
				bodyText: row.bodyText || '',
				receivedAt: row.receivedAt,
			});
			await this.bumpUsage(row.userId, 'ai_requests');
			await this.bumpUsage(row.userId, 'emails_processed');
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
					arabicSummary: generated.arabicSummary,
					formattedMessage: format(generated),
					promptVersion: PROMPT_VERSION,
				}),
			);
		} else if (
			memo.promptVersion !== PROMPT_VERSION ||
			!String(memo.formattedMessage || '').includes('ملخص سريع')
		) {
			memo.formattedMessage = format();
			memo.promptVersion = PROMPT_VERSION;
			await this.memos.save(memo);
		}

		row.status = EmailMemoMessageStatus.AI_COMPLETED;
		row.skipReason = null;
		await this.messages.save(row);
		this.gateway.emitToUser(row.userId, 'email-memo:message', {
			id: row.id,
			status: row.status,
			subject: row.subject,
		});
		return memo;
	}

	async processPipeline(
		row: EmailMemoGmailMessage,
		settings?: EmailMemoNotificationSettings,
		opts: { forceSend?: boolean; bypassDigest?: boolean } = {},
	) {
		if (row.status === EmailMemoMessageStatus.SENT) return;
		const cfg = settings || (await this.settings.getOrCreate(row.userId));
		row.attemptCount = (Number(row.attemptCount) || 0) + 1;
		row.errorMessage = null;
		await this.messages.save(row);

		try {
			const memo = await this.ensureMemo(row, cfg);

			const minRank = PRIORITY_RANK[cfg.minPriority] || 1;
			const memoRank = PRIORITY_RANK[memo.priority || 'medium'] || 2;
			if (
				!opts.forceSend &&
				(memoRank < minRank || (cfg.onlyImportant && (memo.priority || '') !== 'high'))
			) {
				row.status = EmailMemoMessageStatus.SKIPPED;
				row.skipReason = 'priority';
				row.processedAt = new Date();
				await this.messages.save(row);
				return;
			}

			if (
				!wantsWhatsAppDelivery(cfg, Boolean(opts.forceSend)) &&
				!wantsInSiteDelivery(cfg) &&
				!opts.forceSend
			) {
				row.processedAt = new Date();
				await this.messages.save(row);
				return;
			}

			if (!opts.forceSend && !opts.bypassDigest && cfg.notificationMode !== 'immediate') {
				row.sendAfter =
					cfg.notificationMode === 'batch30'
						? new Date(Date.now() + 30 * 60 * 1000)
						: this.nextDigestTime(cfg.pollIntervalHours);
				await this.messages.save(row);
				return;
			}

			await this.deliver(row, memo, cfg, { forceSend: Boolean(opts.forceSend) });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			row.status = EmailMemoMessageStatus.FAILED;
			row.errorMessage = message;
			row.nextRetryAt = new Date(Date.now() + this.retryWaitMs(message, row.attemptCount));
			await this.messages.save(row);
			await this.log(row.userId, row.id, 'pipeline', 'error', row.errorMessage);
			this.gateway.emitToUser(row.userId, 'email-memo:message', {
				id: row.id,
				status: row.status,
				error: row.errorMessage,
			});
			if (opts.forceSend) throw error;
		}
	}

	async deliver(
		row: EmailMemoGmailMessage,
		memo: EmailMemoAiMemo,
		settings: EmailMemoNotificationSettings,
		opts: { forceSend?: boolean } = {},
	) {
		const already = await this.waMessages.findOne({
			where: { gmailMessageId: row.id, status: EmailMemoDeliveryStatus.SENT },
		});
		if (already || row.status === EmailMemoMessageStatus.SENT) {
			row.status = EmailMemoMessageStatus.SENT;
			row.processedAt = row.processedAt || new Date();
			row.sendAfter = null;
			row.errorMessage = null;
			await this.messages.save(row);
			return;
		}
		row.status = EmailMemoMessageStatus.SENDING;
		await this.messages.save(row);

		const sendWa = wantsWhatsAppDelivery(settings, Boolean(opts.forceSend));
		const sendInSite = wantsInSiteDelivery(settings) || (!sendWa && Boolean(opts.forceSend));
		const errors: string[] = [];
		let delivered = false;
		let waRecordId: string | null = null;
		let chatId: string | null = null;

		if (sendInSite) {
			try {
				const posted = await this.inSiteInbox.deliverMemo({
					userId: row.userId,
					text: memo.formattedMessage,
					memoId: memo.id,
					gmailMessageId: row.id,
				});
				chatId = posted.chatId;
				const wa = await this.waMessages.save(
					this.waMessages.create({
						userId: row.userId,
						gmailMessageId: row.id,
						aiMemoId: memo.id,
						chatId: posted.chatId,
						providerMessageId: posted.results[0]?.providerMessageId || `in-site:${memo.id}`,
						body: memo.formattedMessage,
						status: EmailMemoDeliveryStatus.SENT,
						sentAt: new Date(),
					}),
				);
				waRecordId = wa.id;
				delivered = true;
				await this.log(row.userId, row.id, 'in_site', 'info', 'Memo posted to WhatsApp AI inbox');
			} catch (error) {
				errors.push(error instanceof Error ? error.message : String(error));
			}
		}

		if (sendWa) {
			try {
				chatId = await this.whatsapp.resolveTargetChat(row.userId, settings.targetChatId);
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
				waRecordId = wa.id;
				delivered = true;
				await this.log(row.userId, row.id, 'whatsapp', 'info', 'Memo sent');
			} catch (error) {
				errors.push(error instanceof Error ? error.message : String(error));
			}
		}

		if (!delivered) {
			throw new Error(errors.join(' | ') || 'Email memo delivery failed');
		}

		row.status = EmailMemoMessageStatus.SENT;
		row.processedAt = new Date();
		row.errorMessage = errors.length ? errors.join(' | ') : null;
		row.skipReason = null;
		row.nextRetryAt = null;
		await this.messages.save(row);
		await this.bumpUsage(row.userId, 'whatsapp_sent');
		this.gateway.emitToUser(row.userId, 'email-memo:message', {
			id: row.id,
			status: row.status,
			whatsappMessageId: waRecordId,
			deliveryDestination: normalizeDeliveryDestination(settings.deliveryDestination),
		});
	}

	async retryDue() {
		await this.expireBeforeToday();
		const start = startOfZonedDay();
		const due = await this.messages.find({
			where: [
				{ status: EmailMemoMessageStatus.FAILED, receivedAt: MoreThanOrEqual(start) },
				{ status: EmailMemoMessageStatus.AI_COMPLETED, receivedAt: MoreThanOrEqual(start) },
			],
			order: { updatedAt: 'ASC' },
			take: 80,
		});
		for (const row of due) {
			if (row.nextRetryAt && row.nextRetryAt.getTime() > Date.now()) continue;
			const settings = await this.settings.getOrCreate(row.userId);
			try {
				await this.processPipeline(row, settings, { bypassDigest: true });
			} catch (error) {
				row.attemptCount += 1;
				row.errorMessage = error instanceof Error ? error.message : String(error);
				row.nextRetryAt = new Date(
					Date.now() + this.retryWaitMs(row.errorMessage, row.attemptCount),
				);
				await this.messages.save(row);
			}
		}
	}

	async sendDueBatches() {
		const start = startOfZonedDay();
		const due = await this.messages.find({
			where: {
				status: EmailMemoMessageStatus.AI_COMPLETED,
				receivedAt: MoreThanOrEqual(start),
			},
			take: 200,
		});
		const now = Date.now();
		const grouped = new Map<string, EmailMemoGmailMessage[]>();
		const horizonByUser = new Map<string, number>();
		for (const row of due) {
			if (!row.receivedAt || row.receivedAt.getTime() < start.getTime()) continue;
			if (row.sendAfter && row.sendAfter.getTime() > now) {
				if (!horizonByUser.has(row.userId)) {
					const settings = await this.settings.getOrCreate(row.userId);
					const hours = Math.min(24, Math.max(1, Number(settings.pollIntervalHours) || 1));
					horizonByUser.set(
						row.userId,
						settings.notificationMode === 'batch30' ? 30 * 60 * 1000 : hours * 60 * 60 * 1000,
					);
				}
				if (row.sendAfter.getTime() - now <= (horizonByUser.get(row.userId) || 0)) continue;
			}
			const list = grouped.get(row.userId) || [];
			list.push(row);
			grouped.set(row.userId, list);
		}
		for (const [userId, rows] of grouped) {
			const settings = await this.settings.getOrCreate(userId);
			if (settings.notificationMode === 'immediate') continue;
			const memoLines: string[] = ['📧 Email Memo Digest', ''];
			const memoRows: Array<{ row: EmailMemoGmailMessage; memo: EmailMemoAiMemo }> = [];
			for (const row of rows) {
				const memo = await this.memos.findOne({ where: { gmailMessageId: row.id } });
				if (!memo) continue;
				memoLines.push(memo.formattedMessage, '');
				memoRows.push({ row, memo });
			}
			if (memoLines.length <= 2 || !memoRows.length) continue;
			const digestText = memoLines.join('\n').trim();
			try {
				const sendWa = wantsWhatsAppDelivery(settings, false);
				const sendInSite = wantsInSiteDelivery(settings);
				if (!sendWa && !sendInSite) continue;
				const errors: string[] = [];
				let delivered = false;
				if (sendInSite) {
					try {
						await this.inSiteInbox.deliverMemo({
							userId,
							text: digestText,
							memoId: memoRows[0]?.memo.id,
						});
						delivered = true;
					} catch (error) {
						errors.push(error instanceof Error ? error.message : String(error));
					}
				}
				if (sendWa) {
					try {
						const chatId = await this.whatsapp.resolveTargetChat(
							userId,
							settings.targetChatId,
						);
						const linked = await this.whatsapp.getConnection(userId);
						if (!linked.connected || !chatId) {
							throw new Error('WhatsApp is not connected');
						}
						await this.whatsapp.sendText(userId, chatId, digestText);
						delivered = true;
					} catch (error) {
						errors.push(error instanceof Error ? error.message : String(error));
					}
				}
				if (!delivered) throw new Error(errors.join(' | ') || 'Digest delivery failed');
				for (const { row } of memoRows) {
					row.status = EmailMemoMessageStatus.SENT;
					row.processedAt = new Date();
					row.sendAfter = null;
					row.errorMessage = null;
					await this.messages.save(row);
				}
				await this.bumpUsage(userId, 'whatsapp_sent');
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn(`Digest send failed: ${message}`);
				const wait = this.retryWaitMs(message, 1);
				for (const row of rows) {
					row.sendAfter = new Date(Date.now() + wait);
					row.errorMessage = message;
					await this.messages.save(row);
				}
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

	private nextDigestTime(pollIntervalHours?: number) {
		const hours = Math.min(24, Math.max(1, Number(pollIntervalHours) || 1));
		return new Date(Date.now() + hours * 60 * 60 * 1000);
	}

	private retryWaitMs(message: string, attempt: number) {
		if (/whatsapp is not connected/i.test(String(message || ''))) {
			return 60 * 1000;
		}
		return Math.min(15 * 60 * 1000, 2000 * 2 ** Math.min(Math.max(attempt, 1), 6));
	}

	private async bumpUsage(userId: string, field: 'emails_processed' | 'ai_requests' | 'whatsapp_sent') {
		const day = utcDay();
		let row = await this.usage.findOne({ where: { userId, day } });
		if (!row) {
			row = this.usage.create({
				userId,
				day,
				emailsProcessed: 0,
				aiRequests: 0,
				whatsappSent: 0,
			});
		}
		row.emailsProcessed = Math.max(0, Number(row.emailsProcessed) || 0);
		row.aiRequests = Math.max(0, Number(row.aiRequests) || 0);
		row.whatsappSent = Math.max(0, Number(row.whatsappSent) || 0);
		if (field === 'emails_processed') row.emailsProcessed = row.emailsProcessed + 1;
		if (field === 'ai_requests') row.aiRequests = row.aiRequests + 1;
		if (field === 'whatsapp_sent') row.whatsappSent = row.whatsappSent + 1;
		await this.usage.save(row);
	}

	private async expireBeforeToday(connection?: EmailMemoGmailConnection) {
		const start = startOfZonedDay();
		const qb = this.messages
			.createQueryBuilder()
			.update(EmailMemoGmailMessage)
			.set({
				status: EmailMemoMessageStatus.SKIPPED,
				skipReason: 'old_email',
			})
			.where('received_at IS NOT NULL AND received_at < :start', { start })
			.andWhere('status NOT IN (:...keep)', {
				keep: [EmailMemoMessageStatus.SENT, EmailMemoMessageStatus.SKIPPED],
			});
		if (connection) {
			qb.andWhere('gmail_connection_id = :cid', { cid: connection.id });
		}
		await qb.execute();
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

	async sendNow(userId: string, opts: { ids?: string[]; limit?: number } = {}) {
		const settings = await this.settings.getOrCreate(userId);
		const take = Math.min(Math.max(Number(opts.limit) || 100, 1), 150);
		const ids = (opts.ids || []).map((id) => String(id || '').trim()).filter(Boolean).slice(0, 150);

		this.emitSendProgress(userId, { phase: 'collect', current: 0, total: 0 });
		if (!ids.length) {
			const connections = await this.gmail.listConnectedForUser(userId);
			for (const connection of connections) {
				try {
					await this.expireBeforeToday(connection);
					await this.importTodaysInbox(connection);
				} catch (error) {
					this.logger.warn(
						`Send now import failed for ${connection.id}: ${error instanceof Error ? error.message : error}`,
					);
				}
			}
		}

		const start = startOfZonedDay();
		const loaded = ids.length
			? await this.messages.find({ where: { userId, id: In(ids) }, order: { receivedAt: 'ASC' } })
			: await this.listUnsentToday(userId, { take: 150 });

		let sent = 0;
		let failed = 0;
		let skipped = 0;
		const eligible: EmailMemoGmailMessage[] = [];
		for (const row of loaded) {
			if (row.status === EmailMemoMessageStatus.SENT) {
				skipped += 1;
				continue;
			}
			if (!row.receivedAt || row.receivedAt.getTime() < start.getTime()) {
				skipped += 1;
				continue;
			}
			if (
				row.skipReason === 'old_email' ||
				row.skipReason === 'excluded_sender' ||
				row.skipReason === 'self_sent'
			) {
				skipped += 1;
				continue;
			}
			const sender = String(row.senderEmail || '').trim().toLowerCase();
			if (sender && isSenderExcluded(sender, settings.senderExclude || [])) {
				skipped += 1;
				continue;
			}
			eligible.push(row);
		}
		const rows = eligible.slice(0, take);
		const total = rows.length;
		this.emitSendProgress(userId, { phase: 'memo', current: 0, total });

		const ready: Array<{ row: EmailMemoGmailMessage; memo: EmailMemoAiMemo }> = [];
		for (let i = 0; i < rows.length; i += 1) {
			const row = rows[i];
			try {
				const memo = await this.ensureMemo(row, settings);
				this.emitSendProgress(userId, {
					phase: 'memo',
					current: i + 1,
					total,
					id: row.id,
					subject: row.subject,
					status: row.status,
				});
				this.gateway.emitToUser(userId, 'email-memo:message', {
					id: row.id,
					status: row.status,
					subject: row.subject,
				});
				if (memo && row.status !== EmailMemoMessageStatus.SENT) ready.push({ row, memo });
				else skipped += 1;
			} catch (error) {
				failed += 1;
				row.status = EmailMemoMessageStatus.FAILED;
				row.errorMessage = error instanceof Error ? error.message : String(error);
				await this.messages.save(row);
				this.emitSendProgress(userId, {
					phase: 'memo',
					current: i + 1,
					total,
					id: row.id,
					subject: row.subject,
					status: row.status,
				});
				this.gateway.emitToUser(userId, 'email-memo:message', {
					id: row.id,
					status: row.status,
					subject: row.subject,
					error: row.errorMessage,
				});
				this.logger.warn(
					`Send now memo failed for ${row.id}: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		this.emitSendProgress(userId, { phase: 'send', current: 0, total: ready.length });
		for (let i = 0; i < ready.length; i += 1) {
			const item = ready[i];
			const latest = (await this.messages.findOne({ where: { id: item.row.id } })) || item.row;
			if (latest.status === EmailMemoMessageStatus.SENT) {
				skipped += 1;
				this.emitSendProgress(userId, {
					phase: 'send',
					current: i + 1,
					total: ready.length,
					id: latest.id,
					subject: latest.subject,
					status: latest.status,
				});
				continue;
			}
			try {
				await this.deliver(latest, item.memo, settings);
				const fresh = await this.messages.findOne({ where: { id: latest.id } });
				if (fresh?.status === EmailMemoMessageStatus.SENT) sent += 1;
				else skipped += 1;
				this.emitSendProgress(userId, {
					phase: 'send',
					current: i + 1,
					total: ready.length,
					id: latest.id,
					subject: latest.subject,
					status: fresh?.status || latest.status,
				});
			} catch (error) {
				failed += 1;
				latest.status = EmailMemoMessageStatus.FAILED;
				latest.errorMessage = error instanceof Error ? error.message : String(error);
				await this.messages.save(latest);
				this.emitSendProgress(userId, {
					phase: 'send',
					current: i + 1,
					total: ready.length,
					id: latest.id,
					subject: latest.subject,
					status: latest.status,
				});
				this.gateway.emitToUser(userId, 'email-memo:message', {
					id: latest.id,
					status: latest.status,
					subject: latest.subject,
					error: latest.errorMessage,
				});
				this.logger.warn(
					`Send now deliver failed for ${latest.id}: ${error instanceof Error ? error.message : error}`,
				);
			}
		}

		const result = { sent, failed, skipped, processed: rows.length, total };
		this.emitSendProgress(userId, { phase: 'done', ...result });
		return result;
	}

	private emitSendProgress(userId: string, payload: Record<string, unknown>) {
		this.gateway.emitToUser(userId, 'email-memo:send-progress', payload);
	}
}
