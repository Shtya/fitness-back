import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { User } from '../../../entities/global.entity';
import { WhatsAppSyncService } from './whatsapp-sync.service';
import { WhatsAppVoiceChangerService } from './whatsapp-voice-changer.service';
import { probeAudioSeconds, runFfmpeg } from '../utils/whatsapp-voice-ogg';
import {
	VOICE_EDIT_MAX_SECONDS,
	type VoiceEditOptions,
	buildVoiceEditFfmpegArgs,
	normalizeVoiceEditOptions,
} from '../utils/whatsapp-voice-editor';

export type PreparedVoiceEdit = {
	filePath: string;
	seconds: number;
	mimeType: string;
	cleanup: () => Promise<void>;
};

/**
 * Builds a WhatsApp voice note out of an existing video/audio attachment,
 * applying the mini-editor options (trim, gain, denoise, enhance, isolate).
 *
 * Lives next to the sync service rather than inside it so the isolation
 * dependency on the voice-changer service does not become a cycle: this service
 * depends on both, neither depends on this one.
 */
@Injectable()
export class WhatsAppVoiceEditorService {
	private readonly logger = new Logger(WhatsAppVoiceEditorService.name);

	constructor(
		private readonly sync: WhatsAppSyncService,
		private readonly voiceChanger: WhatsAppVoiceChangerService,
	) {}

	/** What the editor UI needs before showing anything: duration and feature availability. */
	async describeSource(user: User, attachmentId: string) {
		const attachment = await this.sync.assertAttachmentVisible(user, attachmentId);
		const type = String(attachment.type || '').toLowerCase();
		if (!['video', 'audio', 'ptt', 'voice', 'document'].includes(type)) {
			throw new BadRequestException('This attachment has no audio track to send as a voice note');
		}
		const source = await this.sync.resolveAttachmentFile(user, attachmentId);
		const sourceSeconds = await probeAudioSeconds(source.absolutePath);
		if (sourceSeconds <= 0) {
			throw new BadRequestException('This video has no audio track');
		}
		return {
			attachmentId,
			sourceSeconds: Number(sourceSeconds.toFixed(3)),
			maxSeconds: VOICE_EDIT_MAX_SECONDS,
			canRemoveBackgroundMusic: await this.voiceChanger.hasElevenLabsKey(user.id),
		};
	}

	/**
	 * Renders the edit. `target: 'mp3'` is the preview encoding; `'ogg'` is what
	 * actually gets sent as a PTT.
	 */
	async render(
		user: User,
		attachmentId: string,
		rawOptions: unknown,
		target: 'ogg' | 'mp3' = 'ogg',
	): Promise<PreparedVoiceEdit> {
		const source = await this.sync.resolveAttachmentFile(user, attachmentId);
		const sourceSeconds = await probeAudioSeconds(source.absolutePath);
		if (sourceSeconds <= 0) {
			throw new BadRequestException('This video has no audio track');
		}
		const options = normalizeVoiceEditOptions(rawOptions as any, sourceSeconds);

		const temps: string[] = [];
		const cleanupTemps = async () => {
			await Promise.all(temps.map((file) => fs.rm(file, { force: true }).catch(() => undefined)));
		};

		try {
			let input = source.absolutePath;

			// Without isolation this is a single FFmpeg pass doing everything at once.
			let pass: VoiceEditOptions = options;

			if (options.removeBackgroundMusic) {
				// Isolation is billed per second and slow, so cut the selection first and
				// hand the service only the part that will actually be sent. This pass is
				// trim-only: the cleanup filters run after isolation, on its output, so
				// nothing gets processed twice.
				const trimmed = this.tempFile('trim', 'mp3');
				temps.push(trimmed);
				const trimPass: VoiceEditOptions = {
					...options,
					gain: 1,
					noiseReduction: false,
					voiceEnhancement: false,
				};
				await runFfmpeg(buildVoiceEditFfmpegArgs(input, trimmed, trimPass, 'mp3'), 120_000);

				const isolated = await this.voiceChanger.isolateVoiceFile(user.id, trimmed);
				const isolatedPath = this.tempFile('isolated', 'mp3');
				temps.push(isolatedPath);
				await fs.writeFile(isolatedPath, isolated);
				input = isolatedPath;
				pass = { ...options, startSeconds: 0, endSeconds: null };
			}

			const output = this.tempFile('voice', target);
			await runFfmpeg(buildVoiceEditFfmpegArgs(input, output, pass, target), 180_000);

			const rendered = await probeAudioSeconds(output);
			if (rendered <= 0) {
				await fs.rm(output, { force: true }).catch(() => undefined);
				throw new BadRequestException(
					'The selected part produced no audio. Widen the selection and try again.',
				);
			}
			await cleanupTemps();

			return {
				filePath: output,
				seconds: Math.max(1, Math.round(rendered)),
				mimeType: target === 'mp3' ? 'audio/mpeg' : 'audio/ogg; codecs=opus',
				cleanup: async () => {
					await fs.rm(output, { force: true }).catch(() => undefined);
				},
			};
		} catch (error) {
			await cleanupTemps();
			if (error instanceof BadRequestException) throw error;
			const detail = error instanceof Error ? error.message : String(error);
			this.logger.warn(`Voice edit failed for attachment ${attachmentId}: ${detail}`);
			if ((error as any)?.status) throw error;
			throw new BadRequestException(
				`Could not process this audio (${detail}). Ensure FFmpeg is installed on the server.`,
			);
		}
	}

	/** Renders with the edit options, then sends the result as a PTT voice note. */
	async send(
		user: User,
		conversationId: string,
		attachmentId: string,
		rawOptions: unknown,
		clientMessageId?: string,
	) {
		const prepared = await this.render(user, attachmentId, rawOptions, 'ogg');
		try {
			return await this.sync.sendVoiceFromFile(user, conversationId, prepared.filePath, {
				seconds: prepared.seconds,
				clientMessageId,
			});
		} finally {
			await prepared.cleanup();
		}
	}

	private tempFile(prefix: string, extension: string) {
		const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		return path.join(os.tmpdir(), `wa-${prefix}-${stamp}.${extension}`);
	}
}
