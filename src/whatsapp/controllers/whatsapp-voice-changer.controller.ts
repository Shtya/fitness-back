import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Req,
	StreamableFile,
	UploadedFile,
	UploadedFiles,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { unlink } from 'fs/promises';
import { diskStorage } from 'multer';
import { tmpdir } from 'os';
import { JwtAuthGuard } from '../../auth/guard/jwt-auth.guard';
import { RolesGuard } from '../../auth/guard/roles.guard';
import {
	SaveWhatsAppVoiceChangerCredentialDto,
	SaveWhatsAppVoiceChangerSettingsDto,
	CloneWhatsAppVoiceDto,
	TransformWhatsAppVoiceDto,
} from '../dto/whatsapp.dto';
import {
	VoiceChangerUpload,
	WhatsAppVoiceChangerService,
} from '../services/whatsapp-voice-changer.service';

@Controller('whatsapp/voice-changer')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppVoiceChangerController {
	constructor(private readonly voiceChanger: WhatsAppVoiceChangerService) {}

	@Get()
	getSettings(@Req() req: any) {
		return this.voiceChanger.getSettings(req.user.id);
	}

	@Put()
	saveSettings(@Req() req: any, @Body() dto: SaveWhatsAppVoiceChangerSettingsDto) {
		return this.voiceChanger.saveSettings(req.user.id, dto);
	}

	@Put('providers/:provider/credential')
	saveCredential(
		@Req() req: any,
		@Param('provider') provider: string,
		@Body() dto: SaveWhatsAppVoiceChangerCredentialDto,
	) {
		return this.voiceChanger.saveCredential(req.user.id, provider, dto.apiKey);
	}

	@Delete('providers/:provider/credential')
	removeCredential(@Req() req: any, @Param('provider') provider: string) {
		return this.voiceChanger.removeCredential(req.user.id, provider);
	}

	@Post('clone')
	@UseInterceptors(
		FilesInterceptor('files', 10, {
			storage: diskStorage({
				destination: tmpdir(),
				filename: (_req, _file, callback) => callback(null, `wa-voice-clone-${randomUUID()}`),
			}),
			limits: { fileSize: 15 * 1024 * 1024, files: 10 },
			fileFilter: (_req, file, callback) => {
				const mime = String(file.mimetype || '').toLowerCase();
				const name = String(file.originalname || '').toLowerCase();
				const allowed =
					mime.startsWith('audio/') ||
					mime.includes('webm') ||
					mime.includes('ogg') ||
					mime.includes('mpeg') ||
					mime.includes('wav') ||
					mime.includes('mp4') ||
					/\.(webm|ogg|mp3|wav|m4a|mp4|aac|flac)$/.test(name);
				callback(allowed ? null : new BadRequestException('Unsupported audio format'), allowed);
			},
		}),
	)
	async cloneVoice(
		@Req() req: any,
		@UploadedFiles() files: VoiceChangerUpload[],
		@Body() body: CloneWhatsAppVoiceDto,
	) {
		const samples = files || [];
		try {
			return await this.voiceChanger.cloneVoice(
				req.user.id,
				samples,
				String(body?.name || ''),
				String(body?.consent || '').toLowerCase() === 'true',
				String(body?.cloneProvider || ''),
			);
		} finally {
			await Promise.all(samples.map((file) => unlink(file.path).catch(() => undefined)));
		}
	}

	@Post('transform')
	@UseInterceptors(
		FileInterceptor('file', {
			storage: diskStorage({
				destination: tmpdir(),
				filename: (_req, _file, callback) => callback(null, `wa-voice-changer-${randomUUID()}`),
			}),
			limits: { fileSize: 25 * 1024 * 1024, files: 1 },
			fileFilter: (_req, file, callback) => {
				const mime = String(file.mimetype || '').toLowerCase();
				const allowed =
					mime.startsWith('audio/') ||
					mime.includes('webm') ||
					mime.includes('ogg') ||
					mime.includes('mpeg') ||
					mime.includes('wav') ||
					mime.includes('mp4');
				callback(allowed ? null : new BadRequestException('Unsupported audio format'), allowed);
			},
		}),
	)
	async transform(
		@Req() req: any,
		@UploadedFile() file: VoiceChangerUpload,
		@Body() body: TransformWhatsAppVoiceDto,
	) {
		if (!file) throw new BadRequestException('Audio file is required');
		try {
			const result = await this.voiceChanger.transform(req.user.id, file, {
				provider: body?.provider,
				preset: body?.preset,
				pitchSemitones: body?.pitchSemitones == null ? undefined : Number(body.pitchSemitones),
				voiceId: body?.voiceId,
				apiKey: body?.apiKey,
			});
			return new StreamableFile(result.buffer, {
				type: result.mimeType,
				disposition: `attachment; filename="${result.fileName.replace(/"/g, '')}"`,
			});
		} finally {
			await unlink(file.path).catch(() => undefined);
		}
	}
}
