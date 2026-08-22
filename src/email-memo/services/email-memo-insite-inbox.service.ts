import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
	WhatsAppAccount,
	WhatsAppAccountAccess,
} from '../../whatsapp/entities/whatsapp.entity';
import { WhatsAppSyncService } from '../../whatsapp/services/whatsapp-sync.service';

export const EMAIL_MEMO_AI_CHAT_ID = 'email-memo-ai@so7ba.internal';
export const EMAIL_MEMO_AI_TITLE = 'AI Memo Emails';

@Injectable()
export class EmailMemoInSiteInboxService {
	private readonly logger = new Logger(EmailMemoInSiteInboxService.name);

	constructor(
		private readonly sync: WhatsAppSyncService,
		@InjectRepository(WhatsAppAccount)
		private readonly accounts: Repository<WhatsAppAccount>,
		@InjectRepository(WhatsAppAccountAccess)
		private readonly access: Repository<WhatsAppAccountAccess>,
	) {}

	/** WhatsApp CRM accounts this user can open in the dashboard. */
	async listTargetAccounts(userId: string): Promise<WhatsAppAccount[]> {
		const [owned, grants] = await Promise.all([
			this.accounts.find({ where: { ownerAdminId: userId } }),
			this.access.find({
				where: { userId },
				relations: ['account'],
			}),
		]);
		const byId = new Map<string, WhatsAppAccount>();
		for (const account of owned) byId.set(account.id, account);
		for (const row of grants) {
			if (row.account) byId.set(row.account.id, row.account);
		}
		return [...byId.values()];
	}

	async deliverMemo(input: {
		userId: string;
		text: string;
		memoId?: string | null;
		gmailMessageId?: string | null;
	}) {
		const text = String(input.text || '').trim();
		if (!text) throw new Error('Email memo text is empty');
		const accounts = await this.listTargetAccounts(input.userId);
		if (!accounts.length) {
			throw new Error(
				'No WhatsApp account in the CRM. Open WhatsApp in the dashboard (or create an account) so Email Memo can post the AI inbox chat.',
			);
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
		const accounts = await this.listTargetAccounts(userId);
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
