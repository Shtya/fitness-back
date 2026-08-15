import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateEmailMemoSettingsDto } from '../dto/email-memo.dto';
import {
	EmailMemoGmailMessage,
	EmailMemoProcessingLog,
} from '../entities/email-memo.entity';
import { EmailMemoAiService } from './email-memo-ai.service';
import { EmailMemoGmailService } from './email-memo-gmail.service';
import { EmailMemoProcessorService } from './email-memo-processor.service';
import { EmailMemoSettingsService } from './email-memo-settings.service';
import { EmailMemoWhatsAppService } from './email-memo-whatsapp.service';

@Injectable()
export class EmailMemoService {
	constructor(
		private readonly gmail: EmailMemoGmailService,
		private readonly whatsapp: EmailMemoWhatsAppService,
		private readonly settings: EmailMemoSettingsService,
		private readonly processor: EmailMemoProcessorService,
		private readonly ai: EmailMemoAiService,
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

	async gmailAuthUrl(userId: string, locale?: string, connectionId?: string) {
		return this.gmail.authUrl(userId, locale, connectionId);
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

	async listMessages(userId: string, limit = 40) {
		const rows = await this.messages.find({
			where: { userId },
			order: { receivedAt: 'DESC', createdAt: 'DESC' },
			take: Math.min(Math.max(Number(limit) || 40, 1), 100),
			relations: ['aiMemo', 'whatsappMessages', 'connection'],
		});
		return { items: rows.map((row) => this.toListItem(row)) };
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
		await this.processor.processPipeline(row, settings);
		return { ok: true };
	}

	async updateSettings(userId: string, dto: UpdateEmailMemoSettingsDto) {
		const row = await this.settings.update(userId, dto);
		return this.settings.toPublic(row);
	}

	async listSenders(userId: string) {
		const settings = await this.settings.getOrCreate(userId);
		const excluded = new Set((settings.senderExclude || []).map((item) => this.normalizeEmail(item)));
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
			LIMIT 120
			`,
			[userId],
		);
		const seen = new Set<string>();
		const items = grouped.map((row) => {
			const email = this.normalizeEmail(row.email);
			seen.add(email);
			return {
				email,
				name: row.name || '',
				count: Number(row.count || 0),
				lastReceivedAt: row.lastReceivedAt,
				excluded: excluded.has(email),
			};
		});
		for (const email of excluded) {
			if (!email || seen.has(email)) continue;
			items.push({
				email,
				name: '',
				count: 0,
				lastReceivedAt: null,
				excluded: true,
			});
		}
		return { items, excluded: [...excluded] };
	}

	async excludeSender(userId: string, email: string) {
		const value = this.normalizeEmail(email);
		if (!value) throw new NotFoundException('Email is required');
		const row = await this.settings.getOrCreate(userId);
		const next = Array.from(new Set([...(row.senderExclude || []).map((item) => this.normalizeEmail(item)), value])).filter(Boolean);
		row.senderExclude = next;
		await this.settings.update(userId, { senderExclude: next });
		return this.listSenders(userId);
	}

	async includeSender(userId: string, email: string) {
		const value = this.normalizeEmail(email);
		const row = await this.settings.getOrCreate(userId);
		const next = (row.senderExclude || [])
			.map((item) => this.normalizeEmail(item))
			.filter((item) => item && item !== value);
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
		};
	}
}
