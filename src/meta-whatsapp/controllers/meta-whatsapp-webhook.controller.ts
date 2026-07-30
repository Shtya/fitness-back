import {
	Body,
	Controller,
	Get,
	Headers,
	HttpCode,
	Post,
	Query,
	Req,
	Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MetaWhatsAppWebhookService } from '../services/meta-whatsapp-webhook.service';

@Controller('meta-whatsapp/webhook')
export class MetaWhatsAppWebhookController {
	constructor(private readonly webhooks: MetaWhatsAppWebhookService) {}

	@Get()
	async verify(
		@Query() query: Record<string, string>,
		@Res() res: Response,
	) {
		const challenge = await this.webhooks.verifyChallenge(query);
		return res.status(200).send(challenge);
	}

	@Post()
	@HttpCode(200)
	async receive(
		@Req() req: Request & { rawBody?: Buffer },
		@Headers('x-hub-signature-256') signature: string | undefined,
		@Body() body: any,
	) {
		// Must use exact request bytes — re-stringifying JSON breaks X-Hub-Signature-256.
		const raw = req.rawBody;
		return this.webhooks.handleIncoming(raw, signature, body);
	}
}
