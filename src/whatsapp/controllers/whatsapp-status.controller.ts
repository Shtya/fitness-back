import {
	Body,
	Controller,
	Get,
	Param,
	Post,
	Query,
	Req,
	Res,
	UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { streamResolvedAttachment } from '../utils/whatsapp-attachment-stream';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { PublishWhatsAppStatusDto, ViewWhatsAppStatusDto } from '../dto/whatsapp.dto';
import { WhatsAppStatusService } from '../services/whatsapp-status.service';

const STATUS_CONTENT_CACHE = 'private, max-age=3600';

@Controller('whatsapp/accounts/:accountId/statuses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppStatusController {
	constructor(private readonly statuses: WhatsAppStatusService) {}

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

	@Get('history')
	listHistory(@Req() req: any, @Param('accountId') accountId: string) {
		return this.statuses.listHistory(req.user, accountId);
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
