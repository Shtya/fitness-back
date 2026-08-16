import {
	BadRequestException,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Req,
	Res,
	StreamableFile,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppStickersService } from '../services/whatsapp-stickers.service';

const STICKER_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/jpg', 'image/gif']);

@Controller('whatsapp/accounts/:accountId/stickers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppStickersController {
	constructor(private readonly stickers: WhatsAppStickersService) {}

	@Get()
	list(@Req() req: any, @Param('accountId') accountId: string) {
		return this.stickers.list(req.user, accountId);
	}

	@Post('sync')
	sync(@Req() req: any, @Param('accountId') accountId: string) {
		return this.stickers.syncFromHistory(req.user, accountId);
	}

	@Post()
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: tmpdir(),
				filename: (_req, _file, callback) => callback(null, `wa-sticker-${randomUUID()}`),
			}),
			limits: { fileSize: 15 * 1024 * 1024, files: 1 },
			fileFilter: (_req, file, callback) => {
				const mime = String(file.mimetype || '').toLowerCase();
				const allowed = STICKER_TYPES.has(mime) || mime.startsWith('image/');
				callback(allowed ? null : new BadRequestException('Unsupported sticker format'), allowed);
			},
		}),
	)
	add(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@UploadedFile() file: any,
	) {
		if (!file) throw new BadRequestException('Sticker file is required');
		return this.stickers.addUpload(req.user, accountId, file);
	}

	@Get(':stickerId/content')
	async content(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('stickerId') stickerId: string,
		@Res({ passthrough: true }) res: Response,
	) {
		const file = await this.stickers.stream(req.user, accountId, stickerId);
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('Content-Type', file.mimeType);
		res.setHeader('Cache-Control', 'private, max-age=86400');
		res.setHeader(
			'Content-Disposition',
			`inline; filename="${encodeURIComponent(file.fileName)}"`,
		);
		return new StreamableFile(file.stream);
	}

	@Delete(':stickerId')
	remove(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@Param('stickerId') stickerId: string,
	) {
		return this.stickers.remove(req.user, accountId, stickerId);
	}
}
