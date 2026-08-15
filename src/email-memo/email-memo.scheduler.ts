import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EmailMemoGmailService } from './services/email-memo-gmail.service';
import { EmailMemoProcessorService } from './services/email-memo-processor.service';

@Injectable()
export class EmailMemoScheduler {
	private readonly logger = new Logger(EmailMemoScheduler.name);
	private ticking = false;

	constructor(
		private readonly gmail: EmailMemoGmailService,
		private readonly processor: EmailMemoProcessorService,
	) {}

	@Cron(CronExpression.EVERY_MINUTE)
	async pollGmail() {
		if (this.ticking) return;
		this.ticking = true;
		try {
			const rows = await this.gmail.listConnected();
			for (const row of rows) {
				try {
					await this.processor.processConnection(row);
				} catch (error) {
					this.logger.warn(
						`Gmail poll failed for ${row.gmailAddress}: ${
							error instanceof Error ? error.message : error
						}`,
					);
				}
			}
			await this.processor.retryDue();
			await this.processor.sendDueBatches();
		} finally {
			this.ticking = false;
		}
	}

	@Cron('0 4 * * *')
	async renewWatches() {
		try {
			await this.gmail.refreshWatches();
		} catch (error) {
			this.logger.warn(`Gmail watch renewal failed: ${error instanceof Error ? error.message : error}`);
		}
	}
}
