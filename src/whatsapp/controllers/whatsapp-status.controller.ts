import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Put,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtOrMediaTokenGuard } from '../guards/jwt-or-media-token.guard';
import { streamResolvedAttachment } from '../utils/whatsapp-attachment-stream';
import {
	signedStatusMediaPath,
	signMediaToken,
	statusMediaResourceId,
} from '../utils/whatsapp-media-signed-url';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	PublishWhatsAppStatusDto,
	LikeWhatsAppStatusDto,
	ReactWhatsAppStatusDto,
	RepostWhatsAppStatusDto,
	ReplyWhatsAppStatusDto,
	UpdateWhatsAppStoryAudienceDto,
	ViewWhatsAppStatusDto,
} from '../dto/whatsapp.dto';
import { WhatsAppStatusService } from '../services/whatsapp-status.service';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';

const STATUS_CONTENT_CACHE = 'private, max-age=3600';
const STATUS_STREAM_TTL_SECONDS = 60 * 60;

/** Range-capable story bytes for a signed URL (or a bearer token). */
@Controller('whatsapp/status-media/:accountId/:scope/:statusId')
@UseGuards(JwtOrMediaTokenGuard)
export class WhatsAppStatusMediaController {
	constructor(private readonly statuses: WhatsAppStatusService) {}

	@Get('content')
	async content(
		@Req() req: Request & { user?: any; waMediaToken?: boolean },
		@Res({ passthrough: true }) res: Response,
		@Param('accountId') accountId: string,
		@Param('scope') scope: string,
		@Param('statusId') statusId: string,
	) {
		if (scope !== 'live' && scope !== 'history') throw new NotFoundException();
		const history = scope === 'history';
		const file = req.waMediaToken
			? await this.statuses.resolveSignedContent(accountId, statusId, history)
			: await this.statuses.resolveContent(req.user, accountId, statusId, { history });
		return streamResolvedAttachment(req, res, file, `status-${scope}-${statusId}`, {
			cacheControl: STATUS_CONTENT_CACHE,
		});
	}
}

@Controller('whatsapp/accounts/:accountId/statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppStatusController {
	constructor(
		private readonly statuses: WhatsAppStatusService,
		private readonly sync: WhatsAppSyncService,
	) {}

	@Get()
	list(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Query('refresh') refresh?: string,
		@Query('debug') debug?: string,
	) {
		return this.statuses.list(
			req.user,
			accountId,
			refresh === 'true',
			debug === 'true' || debug === '1',
		);
	}

	@Post()
	publish(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: PublishWhatsAppStatusDto,
	) {
		return this.statuses.publish(req.user, accountId, body);
	}

	@Get('audience')
	audience(@Req() req: any, @Param('accountId') accountId: string) {
		return this.statuses.getAudience(req.user, accountId);
	}

	@Post('audience/avatar')
	audienceAvatar(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: { waId?: string; quality?: string },
	) {
		return this.statuses.audienceAvatar(
			req.user,
			accountId,
			String(body?.waId || '').slice(0, 80),
			body?.quality === 'full' ? 'full' : 'preview',
		);
	}

	@Put('audience')
	updateAudience(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Body() body: UpdateWhatsAppStoryAudienceDto,
	) {
		return this.statuses.updateAudience(req.user, accountId, body);
	}

	@Get('history')
	listHistory(@Req() req: any, @Param('accountId') accountId: string) {
		return this.statuses.listHistory(req.user, accountId);
	}

	/** A signed URL a `<video>` can stream with Range requests; it cannot send our bearer header. */
	@Get(':statusId/stream-url')
	async streamUrl(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
		@Query('history') history?: string,
	) {
		const isHistory = history === 'true' || history === '1';
		const file = await this.statuses.resolveContent(req.user, accountId, statusId, {
			history: isHistory,
		});
		const scope = isHistory ? 'history' : 'live';
		const signed = signMediaToken(
			statusMediaResourceId(scope, accountId, statusId),
			String(req.user?.id || ''),
			STATUS_STREAM_TTL_SECONDS,
		);
		return {
			url: signedStatusMediaPath(scope, accountId, statusId, signed.token),
			mimeType: file.mimeType,
			expiresAt: signed.expiresAt,
		};
	}

	@Get('history/:statusId/content')
	async historyContent(
		@Req() req: any,
		@Res({ passthrough: true }) res: Response,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
	) {
		const file = await this.statuses.resolveContent(req.user, accountId, statusId, {
			history: true,
		});
		return streamResolvedAttachment(req, res, file, `status-history-${statusId}`, {
			cacheControl: STATUS_CONTENT_CACHE,
		});
	}

	@Post(':providerStatusId/view')
	view(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('providerStatusId') providerStatusId: string,
		@Body() body: ViewWhatsAppStatusDto,
	) {
		return this.statuses.view(
			req.user,
			accountId,
			providerStatusId,
			body?.senderWaId,
		);
	}

	@Get(':statusId/viewers')
	viewers(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
	) {
		return this.statuses.listStatusViewers(req.user, accountId, statusId);
	}

	@Post(':statusId/repost')
	repost(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
		@Body() body: RepostWhatsAppStatusDto,
	) {
		return this.statuses.repost(req.user, accountId, statusId, body);
	}

	@Post(':statusId/reply')
	reply(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
		@Body() body: ReplyWhatsAppStatusDto,
	) {
		return this.sync.replyToStatus(
			req.user,
			accountId,
			statusId,
			body.text,
			body.clientMessageId,
		);
	}

	@Post(':statusId/reactions')
	react(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
		@Body() body: ReactWhatsAppStatusDto,
	) {
		return this.sync.reactToStatus(req.user, accountId, statusId, body.emoji);
	}

	@Put(':statusId/like')
	like(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
		@Body() body: LikeWhatsAppStatusDto,
	) {
		return this.sync.likeStatus(req.user, accountId, statusId, body.liked);
	}

	@Get(':statusId/content')
	async content(
		@Req() req: any,
		@Res({ passthrough: true }) res: Response,
		@Param('accountId') accountId: string,
		@Param('statusId') statusId: string,
	) {
		const file = await this.statuses.resolveContent(req.user, accountId, statusId);
		return streamResolvedAttachment(req, res, file, `status-${statusId}`, {
			cacheControl: STATUS_CONTENT_CACHE,
		});
	}
}
