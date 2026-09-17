import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	ParseIntPipe,
	Post,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { PrepareWhatsAppStoryDto } from '../dto/whatsapp.dto';
import { JwtOrMediaTokenGuard } from '../guards/jwt-or-media-token.guard';
import { WhatsAppStoryService } from '../services/whatsapp-story.service';

/**
 * Adding a chat video to the account's story.
 *
 * Two steps on purpose. `prepare` cuts the video into story-length clips and returns
 * them; `publish` sends them in order. Nothing reaches WhatsApp until the user has
 * seen the parts, which is also what makes a failure mid-sequence recoverable.
 */
@Controller('whatsapp')
export class WhatsAppStoryController {
	constructor(private readonly stories: WhatsAppStoryService) {}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Post('accounts/:accountId/story-drafts')
	prepare(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: PrepareWhatsAppStoryDto,
	) {
		return this.stories.prepare(
			req.user,
			accountId,
			{ attachmentId: body.attachmentId, socialDownloadId: body.socialDownloadId },
			body.caption,
		);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Get('story-drafts/:draftId')
	get(@Req() req: any, @Param('draftId') draftId: string) {
		return this.stories.get(req.user, draftId);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Post('story-drafts/:draftId/publish')
	publish(@Req() req: any, @Param('draftId') draftId: string) {
		return this.stories.publish(req.user, draftId);
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Delete('story-drafts/:draftId')
	remove(@Req() req: any, @Param('draftId') draftId: string) {
		return this.stories.remove(req.user, draftId);
	}

	/**
	 * Preview playback for one clip, with Range support so the review player can seek.
	 *
	 * Takes a signed `?token=` as well as a bearer header: the `<video>` element that
	 * fetches these bytes cannot set headers.
	 */
	@UseGuards(JwtOrMediaTokenGuard)
	@Get('story-drafts/:draftId/parts/:index/content')
	async partContent(
		@Req() req: Request & { user: any },
		@Res() res: Response,
		@Param('draftId') draftId: string,
		@Param('index', ParseIntPipe) index: number,
	) {
		const file = await this.stories.resolvePartFile(req.user, draftId, index);
		res.setHeader('Content-Type', file.mimeType);
		res.setHeader('Accept-Ranges', 'bytes');
		// Private: these bytes belong to one user, and the signature in the URL expires.
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
}
