import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { UpdateEmailMemoSettingsDto } from '../dto/email-memo.dto';
import {
	EmailMemoGmailMessage,
	EmailMemoMessageStatus,
	EmailMemoProcessingLog,
} from '../entities/email-memo.entity';
import { addExcludedSender, removeExcludedSender, senderProvider, isSenderExcluded } from '../utils/email-memo.utils';
import { EmailMemoAiService } from './email-memo-ai.service';
import { EmailMemoGmailService } from './email-memo-gmail.service';
import { EmailMemoProcessorService } from './email-memo-processor.service';
import { EmailMemoSettingsService } from './email-memo-settings.service';
import { EmailMemoWhatsAppService } from './email-memo-whatsapp.service';
import { EmailMemoInSiteInboxService } from './email-memo-insite-inbox.service';

@Injectable()
export class EmailMemoService {
	constructor(
		private readonly gmail: EmailMemoGmailService,
		private readonly whatsapp: EmailMemoWhatsAppService,
		private readonly settings: EmailMemoSettingsService,
		private readonly processor: EmailMemoProcessorService,
		private readonly ai: EmailMemoAiService,
		private readonly inSiteInbox: EmailMemoInSiteInboxService,
		@InjectRepository(EmailMemoGmailMessage)
		private readonly messages: Repository<EmailMemoGmailMessage>,
		@InjectRepository(EmailMemoProcessingLog)
		private readonly logs: Repository<EmailMemoProcessingLog>,
	) {}

	async overview(userId: string) {
		const [accounts, whatsapp, settings, usage] = await Promise.all([
			this.gmail.listForUser(userId),
			this.whatsapp.getConnection(userId),
			this.settings.getOrCreate(userId),
			this.processor.usageToday(userId),
		]);
		const providers = this.ai.listStatus();
		const oauth = await this.gmail.oauthAppMeta(userId);
		const activeProvider =
			providers.find((item) => item.id === settings.aiProvider && item.configured) ||
			providers.find((item) => item.configured) ||
			providers[0];
		const gmailAccounts = accounts.map((row) => this.gmail.toPublicAccount(row));
		const connected = gmailAccounts.filter((item) => item.connected);
		const primary = connected[0] || gmailAccounts[0];
		return {
			gmail: primary?.connected
				? {
						connected: true,
						status: primary.status,
						email: primary.email,
						lastSyncedAt: primary.lastSyncedAt,
						watchEnabled: primary.watchEnabled,
						pushConfigured: Boolean(this.gmail.pubsubTopic()),
						lastError: primary.lastError,
						count: connected.length,
					}
				: {
						connected: false,
						status: primary?.status || 'disconnected',
						email: null,
						pushConfigured: Boolean(this.gmail.pubsubTopic()),
						count: 0,
					},
			gmailAccounts,
			whatsapp: {
				connected: whatsapp.connected,
				status: whatsapp.status,
				deviceName: whatsapp.deviceName,
				phoneNumber: whatsapp.phoneNumber,
				online: whatsapp.online,
				qr: whatsapp.qr,
				pairingCode: whatsapp.pairingCode,
				accountId: whatsapp.accountId,
				lastError: whatsapp.lastError,
				accounts: whatsapp.accounts,
				maxAccounts: whatsapp.maxAccounts,
				linkingAccountId: whatsapp.linkingAccountId,
			},
			ai: {
				provider: activeProvider?.id || 'ai-free',
				label: activeProvider?.label || 'AI Free',
				configured: true,
				providers,
				preview: this.ai.formatWhatsApp({
					settings,
					fromLabel: 'Client Name',
					subjectLabel: 'Meeting confirmation',
					memoText: 'The client confirmed tomorrow’s session and asked to send the invoice.',
					actionText: 'Send the invoice today.',
					deadline: 'none',
					gmailUrl: 'https://mail.google.com',
					inboxLabel: connected[0]?.email || 'you@gmail.com',
					arabicSummary:
						'الميل من العميل عن تأكيد جلسة الغد، وبيطلب فاتورة. المطلوب تبعت الفاتورة اليوم.',
					receivedAt: new Date(),
				}),
			},
			googleOAuth: oauth,
			googleOAuthConfigured: oauth.configured,
			googleOAuthVerified: oauth.verified,
			googleOAuthEasy: oauth.easyConnect,
			settings: this.settings.toPublic(settings),
			usage,
		};
	}

	async gmailAuthUrl(
		userId: string,
		locale?: string,
		connectionId?: string,
		returnOrigin?: string,
		popup?: boolean,
	) {
		return this.gmail.authUrl(userId, locale, connectionId, returnOrigin, popup);
	}

	async syncGmail(userId: string, connectionId?: string) {
		const rows = connectionId
			? [await this.gmail.getConnectionById(connectionId)].filter(Boolean)
			: await this.gmail.listConnectedForUser(userId);
		if (!rows.length) throw new NotFoundException('Gmail is not connected');
		const owned = rows.filter((row) => row.userId === userId && row.status === 'connected');
		if (!owned.length) throw new NotFoundException('Gmail is not connected');
		const results = [];
		for (const connection of owned) {
			results.push(await this.processor.processConnection(connection));
		}
		return { accounts: owned.length, queued: results.reduce((sum, item) => sum + item.queued, 0) };
	}

	async importInbox(
		userId: string,
		opts: { connectionId?: string; pageToken?: string; limit?: number } = {},
	) {
		const rows = opts.connectionId
			? [await this.gmail.getConnectionById(opts.connectionId)].filter(Boolean)
			: await this.gmail.listConnectedForUser(userId);
		const owned = rows.filter((row) => row && row.userId === userId && row.status === 'connected');
		if (!owned.length) throw new NotFoundException('Gmail is not connected');
		const accounts = [];
		let imported = 0;
		let listed = 0;
		let hasMore = false;
		let nextPageToken: string | null = null;
		for (const connection of owned) {
			const result = await this.processor.importInbox(connection, {
				pageToken: opts.pageToken,
				max: opts.limit || 50,
			});
			imported += result.imported;
			listed += result.listed;
			if (result.hasMore) hasMore = true;
			nextPageToken = result.nextPageToken;
			accounts.push({
				id: connection.id,
				email: connection.gmailAddress,
				imported: result.imported,
				listed: result.listed,
				nextPageToken: result.nextPageToken,
				hasMore: result.hasMore,
				inboxEstimate: result.inboxEstimate,
			});
		}
		return {
			imported,
			listed,
			hasMore,
			nextPageToken: owned.length === 1 ? nextPageToken : null,
			accounts,
		};
	}

	async listMessages(
		userId: string,
		opts: { limit?: number; sender?: string; inbox?: string; q?: string } = {},
	) {
		const take = Math.min(Math.max(Number(opts.limit) || 80, 1), 500);
		const sender = String(opts.sender || '').trim();
		const inbox = String(opts.inbox || '').trim().toLowerCase();
		const q = String(opts.q || '').trim();
		const where: any = { userId };
		if (sender) where.senderEmail = ILike(`%${sender}%`);
		if (q) where.subject = ILike(`%${q}%`);
		const rows = await this.messages.find({
			where,
			order: { receivedAt: 'DESC', createdAt: 'DESC' },
			take,
			relations: ['aiMemo', 'whatsappMessages', 'connection'],
		});
		const items = rows
			.map((row) => this.toListItem(row))
			.filter((item) => (inbox ? String(item.inboxEmail || '').toLowerCase() === inbox : true));
		const total = await this.messages.count({ where: { userId } });
		return { items, total };
	}

	async messageDetail(userId: string, id: string) {
		const row = await this.messages.findOne({
			where: { id, userId },
			relations: ['aiMemo', 'whatsappMessages', 'connection'],
		});
		if (!row) throw new NotFoundException('Email not found');
		const logs = await this.logs.find({
			where: { gmailMessageId: row.id },
			order: { createdAt: 'DESC' },
			take: 30,
		});
		return {
			...this.toListItem(row),
			bodyText: row.bodyText,
			labelIds: row.labelIds,
			errorMessage: row.errorMessage,
			skipReason: row.skipReason,
			processedAt: row.processedAt,
			gmailUrl: row.gmailUrl,
			logs: logs.map((log) => ({
				stage: log.stage,
				level: log.level,
				message: log.message,
				createdAt: log.createdAt,
			})),
		};
	}

	async retryMessage(userId: string, id: string) {
		const row = await this.messages.findOne({ where: { id, userId } });
		if (!row) throw new NotFoundException('Email not found');
		const settings = await this.settings.getOrCreate(userId);
		const dest = String(settings.deliveryDestination || 'whatsapp').toLowerCase();
		const needsPhone = dest === 'whatsapp' || dest === 'both';
		if (needsPhone) {
			const wa = await this.whatsapp.getConnection(userId);
			if (!wa.connected) {
				throw new BadRequestException('WhatsApp is not connected. Scan the QR code first.');
			}
		}
		try {
			await this.processor.processPipeline(row, settings, { forceSend: true });
		} catch (error) {
			throw new BadRequestException(error instanceof Error ? error.message : String(error));
		}
		const fresh = await this.messages.findOne({ where: { id, userId } });
		if (!fresh || fresh.status !== EmailMemoMessageStatus.SENT) {
			throw new BadRequestException(fresh?.errorMessage || 'Retry failed. Memo was not sent.');
		}
		return { ok: true, status: fresh.status };
	}

	async sendNow(userId: string, opts: { ids?: string[]; limit?: number } = {}) {
		const settings = await this.settings.getOrCreate(userId);
		const dest = String(settings.deliveryDestination || 'whatsapp').toLowerCase();
		const needsPhone = dest === 'whatsapp' || dest === 'both';
		if (needsPhone) {
			const wa = await this.whatsapp.getConnection(userId);
			if (!wa.connected) throw new BadRequestException('WhatsApp is not connected');
		}
		return this.processor.sendNow(userId, opts);
	}

	async updateSettings(userId: string, dto: UpdateEmailMemoSettingsDto) {
		const row = await this.settings.update(userId, dto);
		const dest = String(row.deliveryDestination || 'whatsapp').toLowerCase();
		if (dest === 'in_site' || dest === 'both') {
			void this.inSiteInbox.ensurePinnedInbox(userId).catch(() => undefined);
		}
		return this.settings.toPublic(row);
	}

	async listSenders(userId: string) {
		const settings = await this.settings.getOrCreate(userId);
		const excludedList = settings.senderExclude || [];
		const grouped = await this.messages.query(
			`
			SELECT
				LOWER(sender_email) AS email,
				MAX(sender_name) AS name,
				COUNT(*)::int AS count,
				MAX(received_at) AS "lastReceivedAt"
			FROM email_memo_gmail_messages
			WHERE user_id = $1
				AND sender_email IS NOT NULL
				AND sender_email <> ''
			GROUP BY LOWER(sender_email)
			ORDER BY COUNT(*) DESC, MAX(received_at) DESC NULLS LAST
			LIMIT 400
			`,
			[userId],
		);
		const buckets = new Map<
			string,
			{ email: string; name: string; count: number; lastReceivedAt: Date | null; excluded: boolean }
		>();
		for (const row of grouped) {
			const provider = senderProvider(row.email);
			const current = buckets.get(provider.key);
			const count = Number(row.count || 0);
			const lastReceivedAt = row.lastReceivedAt ? new Date(row.lastReceivedAt) : null;
			const excluded = isSenderExcluded(row.email || provider.key, excludedList);
			const name = provider.key.includes('@')
				? (String(row.name || '').trim() || provider.label)
				: provider.label;
			if (!current) {
				buckets.set(provider.key, {
					email: provider.key,
					name,
					count,
					lastReceivedAt,
					excluded,
				});
				continue;
			}
			current.count += count;
			current.excluded = current.excluded || excluded;
			if (!current.lastReceivedAt || (lastReceivedAt && lastReceivedAt > current.lastReceivedAt)) {
				current.lastReceivedAt = lastReceivedAt;
			}
		}
		const items = [...buckets.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
		const seen = new Set(items.map((item) => item.email));
		for (const value of excludedList) {
			const provider = senderProvider(value);
			if (!provider.key || seen.has(provider.key)) continue;
			seen.add(provider.key);
			items.push({
				email: provider.key,
				name: provider.label,
				count: 0,
				lastReceivedAt: null,
				excluded: true,
			});
		}
		return { items, excluded: excludedList };
	}

	async excludeSender(userId: string, email: string) {
		const value = this.normalizeEmail(email);
		if (!value) throw new NotFoundException('Email is required');
		const row = await this.settings.getOrCreate(userId);
		const next = addExcludedSender(row.senderExclude || [], value);
		await this.settings.update(userId, { senderExclude: next });
		return this.listSenders(userId);
	}

	async includeSender(userId: string, email: string) {
		const value = this.normalizeEmail(email);
		const row = await this.settings.getOrCreate(userId);
		const next = removeExcludedSender(row.senderExclude || [], value);
		await this.settings.update(userId, { senderExclude: next });
		return this.listSenders(userId);
	}

	private normalizeEmail(value: unknown) {
		return String(value || '').trim().toLowerCase();
	}

	private toListItem(row: EmailMemoGmailMessage) {
		const wa = (row.whatsappMessages || []).sort(
			(a, b) => Number(b.createdAt) - Number(a.createdAt),
		)[0];
		return {
			id: row.id,
			status: row.status,
			senderName: row.senderName,
			senderEmail: row.senderEmail,
			inboxEmail: row.connection?.gmailAddress || null,
			subject: row.subject,
			snippet: row.snippet,
			memo: row.aiMemo?.memoText || null,
			formattedMessage: row.aiMemo?.formattedMessage || null,
			priority: row.aiMemo?.priority || null,
			action: row.aiMemo?.actionText || null,
			whatsappStatus: wa?.status || (row.status === 'SENT' ? 'sent' : null),
			receivedAt: row.receivedAt || row.createdAt,
			gmailUrl: row.gmailUrl,
			skipReason: row.skipReason || null,
		};
	}
}
