import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from '../../../entities/global.entity';
import { WhatsAppAccount } from '../../whatsapp/entities/whatsapp.entity';
import { WhatsAppAccountsService } from '../../whatsapp/services/whatsapp-accounts.service';
import { WhatsAppSyncService } from '../../whatsapp/services/whatsapp-sync.service';

export const EMAIL_MEMO_AI_CHAT_ID = 'email-memo-ai@so7ba.internal';
export const EMAIL_MEMO_AI_TITLE = 'AI Memo Emails';

@Injectable()
export class EmailMemoInSiteInboxService {
	private readonly logger = new Logger(EmailMemoInSiteInboxService.name);

	constructor(
		private readonly sync: WhatsAppSyncService,
		private readonly accountsService: WhatsAppAccountsService,
		@InjectRepository(User)
		private readonly users: Repository<User>,
		@InjectRepository(WhatsAppAccount)
		private readonly accounts: Repository<WhatsAppAccount>,
	) {}

	/** WhatsApp CRM accounts this user can open in the dashboard. */
	async listTargetAccounts(userId: string): Promise<WhatsAppAccount[]> {
		const user = await this.users.findOne({ where: { id: userId } });
		if (!user) return [];
		const listed = await this.accountsService.list(user);
		const ids = listed.map((item) => String(item.id || '')).filter(Boolean);
		if (!ids.length) return [];
		return this.accounts.find({ where: { id: In(ids) } });
	}

	async ensureTargetAccounts(userId: string): Promise<WhatsAppAccount[]> {
		const existing = await this.listTargetAccounts(userId);
		if (existing.length) return existing;
		const user = await this.users.findOne({ where: { id: userId } });
		if (!user) throw new Error('User not found');
		const created = await this.accountsService.create(user, {
			label: EMAIL_MEMO_AI_TITLE,
			providerName: process.env.WHATSAPP_PROVIDER || 'baileys',
		});
		this.logger.log(`Created in-site Email Memo inbox account ${created.id} for ${userId}`);
		const row = await this.accounts.findOne({ where: { id: created.id } });
		return row ? [row] : [];
	}

	async deliverMemo(input: {
		userId: string;
		text: string;
		memoId?: string | null;
		gmailMessageId?: string | null;
	}) {
		const text = String(input.text || '').trim();
		if (!text) throw new Error('Email memo text is empty');
		const accounts = await this.ensureTargetAccounts(input.userId);
		if (!accounts.length) {
			throw new Error('Could not create the in-site AI Memo Emails inbox');
		}
		const providerMessageId = `email-memo:${input.memoId || randomUUID()}:${Date.now()}`;
		const results = [];
		for (const account of accounts) {
			try {
				const posted = await this.sync.postEmailMemoSiteMessage({
					accountId: account.id,
					userId: input.userId,
					text,
					providerMessageId: `${providerMessageId}:${account.id}`,
					title: EMAIL_MEMO_AI_TITLE,
				});
				results.push(posted);
			} catch (error) {
				this.logger.warn(
					`In-site Email Memo post failed for account ${account.id}: ${
						error instanceof Error ? error.message : error
					}`,
				);
			}
		}
		if (!results.length) {
			throw new Error('Could not post Email Memo into the in-site WhatsApp inbox');
		}
		return { chatId: EMAIL_MEMO_AI_CHAT_ID, results };
	}

	async ensurePinnedInbox(userId: string) {
		const accounts = await this.ensureTargetAccounts(userId);
		for (const account of accounts) {
			try {
				await this.sync.postEmailMemoSiteMessage({
					accountId: account.id,
					userId,
					text: 'AI Memo Emails inbox is ready. Summaries of your emails will appear here.',
					providerMessageId: `email-memo:welcome:${account.id}`,
					title: EMAIL_MEMO_AI_TITLE,
				});
			} catch (error) {
				this.logger.warn(
					`Could not seed AI inbox for ${account.id}: ${
						error instanceof Error ? error.message : error
					}`,
				);
			}
		}
		return { ok: true, accounts: accounts.length };
	}
}
