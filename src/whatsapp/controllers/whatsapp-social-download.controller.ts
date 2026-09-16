import { Controller, Delete, Get, Param, Post, Body, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { StartWhatsAppSocialDownloadDto } from '../dto/whatsapp.dto';
import { WhatsAppSocialDownloadService } from '../services/whatsapp-social-download.service';

/**
 * Downloading the video behind a social link in a message.
 *
 * `start` returns immediately with a `pending` row; the client polls `status` until
 * it flips to `ready` or `failed`, then plays `content`. There is no queue
 * infrastructure in this service, and yt-dlp routinely outlives an HTTP timeout, so
 * polling is what keeps the request short and the result durable across reloads.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('whatsapp')
export class WhatsAppSocialDownloadController {
	constructor(private readonly downloads: WhatsAppSocialDownloadService) {}

	@Post('conversations/:conversationId/messages/:messageId/social-download')
	start(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
		@Body() body: StartWhatsAppSocialDownloadDto,
	) {
		return this.downloads.start(req.user, conversationId, messageId, body.url);
	}

	@Get('conversations/:conversationId/messages/:messageId/social-download')
	status(
		@Req() req: any,
		@Param('conversationId') conversationId: string,
		@Param('messageId') messageId: string,
	) {
		return this.downloads.status(req.user, conversationId, messageId);
	}

	/** Inline playback. Supports Range so the player can seek without a full fetch. */
	@Get('social-downloads/:downloadId/content')
	async content(
		@Req() req: Request & { user: any },
		@Res() res: Response,
		@Param('downloadId') downloadId: string,
	) {
		const file = await this.downloads.resolveFile(req.user, downloadId);
		res.setHeader('Content-Type', file.mimeType);
		res.setHeader('Accept-Ranges', 'bytes');
		// Private: the response is per-user and the URL carries no signature.
		res.setHeader('Cache-Control', 'private, max-age=600');

		const range = String(req.headers.range || '');
		const match = /^bytes=(\d*)-(\d*)$/.exec(range);
		if (match && file.size > 0) {
			const start = match[1] ? Number(match[1]) : 0;
			const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
			if (Number.isFinite(start) && start <= end && start < file.size) {
				res.status(206);
				res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
				res.setHeader('Content-Length', String(end - start + 1));
				createReadStream(file.absolutePath, { start, end }).pipe(res);
				return;
			}
			res.status(416);
			res.setHeader('Content-Range', `bytes */${file.size}`);
			res.end();
			return;
		}

		res.setHeader('Content-Length', String(file.size));
		createReadStream(file.absolutePath).pipe(res);
	}

	@Delete('social-downloads/:downloadId')
	remove(@Req() req: any, @Param('downloadId') downloadId: string) {
		return this.downloads.remove(req.user, downloadId);
	}
}
