import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WhatsAppMessageSchedulesService } from './services/whatsapp-message-schedules.service';

@Injectable()
export class WhatsAppMessageSchedulesScheduler {
	private readonly logger = new Logger(WhatsAppMessageSchedulesScheduler.name);

	constructor(private readonly schedules: WhatsAppMessageSchedulesService) {}

	@Cron(CronExpression.EVERY_MINUTE)
	async handleDueSchedules() {
		try {
			const result = await this.schedules.processDue(new Date());
			if (result.processed > 0) {
				this.logger.log(`Processed ${result.processed} WhatsApp scheduled message run(s)`);
			}
		} catch (error) {
			this.logger.warn(
				`WhatsApp schedule tick failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
