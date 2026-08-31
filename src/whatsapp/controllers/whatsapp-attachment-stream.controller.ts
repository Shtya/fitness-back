import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtOrMediaTokenGuard } from '../guards/jwt-or-media-token.guard';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';
import { streamResolvedAttachment } from '../utils/whatsapp-attachment-stream';

@Controller('whatsapp/attachments')
@UseGuards(JwtOrMediaTokenGuard)
export class WhatsAppAttachmentStreamController {
	constructor(private readonly sync: WhatsAppSyncService) {}

	@Get(':attachmentId/content')
	async streamAttachment(
		@Req() req: Request & { user?: { id: string }; waMediaToken?: boolean },
		@Param('attachmentId') attachmentId: string,
		@Res({ passthrough: true }) res: Response,
	) {
		const file = req.waMediaToken
			? await this.sync.resolveDownloadedAttachment(attachmentId)
			: await this.sync.resolveAttachmentFile(req.user as any, attachmentId);
		return streamResolvedAttachment(req, res, file, attachmentId);
	}
}
