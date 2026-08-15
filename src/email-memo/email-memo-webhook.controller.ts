import { Controller, ForbiddenException, Post, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailMemoProcessorService } from './services/email-memo-processor.service';

@Controller('email-memo')
export class EmailMemoWebhookController {
	constructor(
		private readonly processor: EmailMemoProcessorService,
		private readonly config: ConfigService,
	) {}

	@Post('gmail/pubsub')
	async pubsub(@Req() req: any, @Query('token') token?: string) {
		const expected = this.config.get<string>('GMAIL_PUBSUB_VERIFICATION_TOKEN')?.trim();
		if (expected && token !== expected) {
			throw new ForbiddenException('Invalid Pub/Sub verification token');
		}
		const encoded = req?.body?.message?.data;
		if (!encoded) return { ok: true };
		let payload: { emailAddress?: string; historyId?: string } = {};
		try {
			payload = JSON.parse(Buffer.from(String(encoded), 'base64').toString('utf8'));
		} catch {
			return { ok: true };
		}
		if (payload.emailAddress) {
			void this.processor.handlePubSub(payload.emailAddress, payload.historyId);
		}
		return { ok: true };
	}
}
