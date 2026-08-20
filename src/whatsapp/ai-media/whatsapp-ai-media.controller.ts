import {
	BadRequestException,
	Controller,
	Get,
	Param,
	Post,
	Req,
	UploadedFile,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import { WhatsAppAiMediaService } from './whatsapp-ai-media.service';

@Controller('whatsapp/accounts/:accountId/ai-media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppAiMediaController {
	constructor(private readonly aiMedia: WhatsAppAiMediaService) {}

	@Get('models')
	models(@Req() req: any, @Param('accountId') accountId: string) {
		return this.aiMedia.listModels(req.user, accountId);
	}

	@Post('generate')
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: tmpdir(),
				filename: (_req, _file, callback) => callback(null, `wa-ai-${randomUUID()}`),
			}),
			limits: { fileSize: 15 * 1024 * 1024, files: 1 },
			fileFilter: (_req, file, callback) => {
				const mime = String(file.mimetype || '').toLowerCase();
				const allowed = mime.startsWith('image/');
				callback(allowed ? null : new BadRequestException('Unsupported image format'), allowed);
			},
		}),
	)
	async generate(
		@Req() req: any,
		@Param('accountId') accountId: string,
		@UploadedFile() file: any,
	) {
		const prompt = String(req.body?.prompt || '').trim();
		if (!prompt) throw new BadRequestException('Prompt is required');
		const controller = new AbortController();
		const onClose = () => controller.abort();
		req.raw?.on?.('close', onClose);
		req.on?.('aborted', onClose);
		try {
			return await this.aiMedia.generate(req.user, accountId, {
				kind: req.body?.kind,
				prompt,
				provider: String(req.body?.provider || '').trim() || undefined,
				model: String(req.body?.model || '').trim() || undefined,
				stickerId: String(req.body?.stickerId || '').trim() || undefined,
				file,
				seed: req.body?.seed,
				signal: controller.signal,
			});
		} finally {
			req.raw?.off?.('close', onClose);
			req.off?.('aborted', onClose);
			if (file?.path) await fs.unlink(file.path).catch(() => undefined);
		}
	}
}
