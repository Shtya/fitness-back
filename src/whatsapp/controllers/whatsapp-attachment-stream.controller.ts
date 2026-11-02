import {
	Controller,
	Get,
	Param,
	Query,
	Req,
	Res,
	UnprocessableEntityException,
	UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtOrMediaTokenGuard } from '../guards/jwt-or-media-token.guard';
import { WhatsAppSyncService } from '../services/whatsapp-sync.service';
import { streamResolvedAttachment } from '../utils/whatsapp-attachment-stream';
import {
	AUDIO_TRACK_FORMAT,
	NoAudioTrackError,
	VOICE_PLAYBACK_FORMAT_M4A,
	audioTrackFileName,
	ensureAudioTrackM4a,
	ensureVoicePlaybackM4a,
	isVideoAttachment,
	needsM4aForPlayback,
	playbackFileName,
} from '../utils/whatsapp-voice-playback';

@Controller('whatsapp/attachments')
@UseGuards(JwtOrMediaTokenGuard)
export class WhatsAppAttachmentStreamController {
	constructor(private readonly sync: WhatsAppSyncService) {}

	@Get(':attachmentId/content')
	async streamAttachment(
		@Req() req: Request & { user?: { id: string }; waMediaToken?: boolean },
		@Param('attachmentId') attachmentId: string,
		@Query('format') format: string | undefined,
		@Res({ passthrough: true }) res: Response,
	) {
		const file = req.waMediaToken
			? await this.sync.resolveDownloadedAttachment(attachmentId)
			: await this.sync.resolveAttachmentFile(req.user as any, attachmentId);
		// iOS Safari cannot decode WhatsApp's Ogg/Opus voice notes; serve AAC instead.
		if (
			format === VOICE_PLAYBACK_FORMAT_M4A &&
			(await needsM4aForPlayback(file.absolutePath, file.mimeType))
		) {
			const absolutePath = await ensureVoicePlaybackM4a(file.absolutePath);
			return streamResolvedAttachment(
				req,
				res,
				{ absolutePath, mimeType: 'audio/mp4', fileName: playbackFileName(file.fileName) },
				attachmentId,
			);
		}
		// Transcription only needs the sound: send the video's audio track, not the video.
		if (format === AUDIO_TRACK_FORMAT && isVideoAttachment(file.fileName, file.mimeType)) {
			let absolutePath: string;
			try {
				absolutePath = await ensureAudioTrackM4a(file.absolutePath);
			} catch (error) {
				if (error instanceof NoAudioTrackError) throw new UnprocessableEntityException(error.message);
				throw error;
			}
			return streamResolvedAttachment(
				req,
				res,
				{ absolutePath, mimeType: 'audio/mp4', fileName: audioTrackFileName(file.fileName) },
				attachmentId,
			);
		}
		return streamResolvedAttachment(req, res, file, attachmentId);
	}
}
