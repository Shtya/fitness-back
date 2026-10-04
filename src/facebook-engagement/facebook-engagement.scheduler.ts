import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FbEngagementWorkerService } from './services/fb-engagement-worker.service';

@Injectable()
export class FacebookEngagementScheduler {
	private readonly logger = new Logger(FacebookEngagementScheduler.name);
	private ticking = false;
	private lastFailure: string | null = null;

	constructor(private readonly worker: FbEngagementWorkerService) {}

	@Interval(5000)
	async tick() {
		if (this.ticking) return;
		this.ticking = true;
		try {
			await this.worker.processDue();
			this.lastFailure = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message !== this.lastFailure) this.logger.warn(`Publishing tick failed: ${message}`);
			this.lastFailure = message;
		} finally {
			this.ticking = false;
		}
	}
}
