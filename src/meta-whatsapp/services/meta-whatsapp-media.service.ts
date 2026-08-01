import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, mkdirSync, promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { MetaWhatsAppMessage } from '../entities/meta-whatsapp.entity';
import { MetaWhatsAppCloudApiService } from './meta-whatsapp-cloud-api.service';
import { MetaWhatsAppConfigService } from './meta-whatsapp-config.service';

@Injectable()
export class MetaWhatsAppMediaService {
	constructor(
		@InjectRepository(MetaWhatsAppMessage)
		private readonly messageRepo: Repository<MetaWhatsAppMessage>,
		private readonly cloudApi: MetaWhatsAppCloudApiService,
		private readonly configService: MetaWhatsAppConfigService,
	) {}

	mediaRoot() {
		const root =
			process.env.META_WHATSAPP_MEDIA_ROOT?.trim() ||
			path.join(process.cwd(), 'storage', 'meta-whatsapp-media');
		if (!existsSync(root)) mkdirSync(root, { recursive: true });
		return root;
	}

	async saveLocalFile(messageId: string, buffer: Buffer, mimeType: string, originalName?: string) {
		const ext = this.extensionFor(mimeType, originalName);
		const fileName = `${messageId}${ext}`;
		const fullPath = path.join(this.mediaRoot(), fileName);
		await fs.writeFile(fullPath, buffer);
		return {
			relativePath: fileName,
			fullPath,
			mimeType,
			fileName: originalName || fileName,
		};
	}

	async getLocalPath(relativePath: string) {
		const full = path.resolve(this.mediaRoot(), relativePath);
		if (!full.startsWith(path.resolve(this.mediaRoot()))) {
			throw new NotFoundException('Invalid media path');
		}
		if (!existsSync(full)) throw new NotFoundException('Media file not found');
		return full;
	}

	async resolveMessageMedia(messageId: string): Promise<{
		buffer: Buffer;
		mimeType: string;
		fileName: string;
	}> {
		const message = await this.messageRepo.findOne({ where: { id: messageId } });
		if (!message) throw new NotFoundException('Message not found');

		if (message.mediaUrl && !/^https?:\/\//i.test(message.mediaUrl)) {
			try {
				const full = await this.getLocalPath(message.mediaUrl);
				const buffer = await fs.readFile(full);
				return {
					buffer,
					mimeType: message.mediaMimeType || 'application/octet-stream',
					fileName: message.mediaFileName || path.basename(full),
				};
			} catch {
				/* fall through */
			}
		}

		if (!message.mediaId && message.rawPayload && typeof message.rawPayload === 'object') {
			const raw = message.rawPayload;
			const bucket =
				raw.sticker || raw.image || raw.video || raw.audio || raw.document || null;
			if (bucket?.id) {
				message.mediaId = String(bucket.id);
				if (bucket.mime_type) message.mediaMimeType = String(bucket.mime_type);
				await this.messageRepo.save(message);
			}
		}

		if (!message.mediaId) throw new NotFoundException('Message has no media');

		const runtime = await this.configService.requireRuntime({ requireEnabled: false });
		const meta = await this.cloudApi.getMediaUrl(
			runtime.secrets.accessToken,
			message.mediaId,
		);
		if (!meta.url) throw new NotFoundException('Meta media URL missing');
		const buffer = await this.cloudApi.downloadMedia(runtime.secrets.accessToken, meta.url);
		const mimeType = meta.mime_type || message.mediaMimeType || 'application/octet-stream';
		const saved = await this.saveLocalFile(
			message.id,
			buffer,
			mimeType,
			message.mediaFileName || undefined,
		);
		message.mediaUrl = saved.relativePath;
		message.mediaMimeType = mimeType;
		await this.messageRepo.save(message);
		return {
			buffer,
			mimeType,
			fileName: message.mediaFileName || saved.fileName,
		};
	}

	extensionFor(mimeType: string, originalName?: string) {
		if (originalName && path.extname(originalName)) return path.extname(originalName);
		const map: Record<string, string> = {
			'image/jpeg': '.jpg',
			'image/png': '.png',
			'image/webp': '.webp',
			'image/gif': '.gif',
			'audio/ogg': '.ogg',
			'audio/mpeg': '.mp3',
			'audio/mp4': '.m4a',
			'audio/aac': '.aac',
			'audio/amr': '.amr',
			'video/mp4': '.mp4',
			'application/pdf': '.pdf',
		};
		return map[mimeType] || '.bin';
	}

	guessMessageType(mimeType: string): 'image' | 'audio' | 'voice' | 'video' | 'document' {
		if (mimeType.startsWith('image/')) return 'image';
		if (mimeType.startsWith('video/')) return 'video';
		if (mimeType.startsWith('audio/')) {
			return mimeType.includes('ogg') ? 'voice' : 'audio';
		}
		return 'document';
	}

	/** Meta Cloud API voice notes need OGG/Opus; browsers usually record WebM. */
	async ensureMetaAudioBuffer(
		buffer: Buffer,
		mimeType: string,
		fileName: string,
		asVoice = false,
	): Promise<{ buffer: Buffer; mimeType: string; fileName: string }> {
		const mime = String(mimeType || '').toLowerCase().split(';')[0].trim();
		if (!mime.startsWith('audio/')) {
			return { buffer, mimeType, fileName };
		}
		if (mime === 'audio/ogg' || mime === 'audio/opus') {
			return {
				buffer,
				mimeType: 'audio/ogg',
				fileName: fileName.replace(/\.[^.]+$/, '') + '.ogg',
			};
		}

		const shouldConvert = asVoice || mime.includes('webm');
		if (!shouldConvert) {
			return { buffer, mimeType: mime, fileName };
		}

		try {
			return await this.convertAudioBufferToOgg(buffer, fileName);
		} catch (error) {
			throw new BadRequestException(
				`Voice conversion failed (install ffmpeg or set FFMPEG_PATH): ${
					error instanceof Error ? error.message : error
				}`,
			);
		}
	}

	private async convertAudioBufferToOgg(buffer: Buffer, fileName: string) {
		const os = await import('os');
		const { spawn } = await import('child_process');
		const tmpRoot = os.tmpdir();
		const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const inputPath = path.join(tmpRoot, `meta-voice-in-${stamp}${path.extname(fileName) || '.webm'}`);
		const outputPath = path.join(tmpRoot, `meta-voice-out-${stamp}.ogg`);

		let executable = process.env.FFMPEG_PATH?.trim() || '';
		if (!executable) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				executable = require('ffmpeg-static') || '';
			} catch {
				executable = 'ffmpeg';
			}
		}
		if (!executable) executable = 'ffmpeg';

		await fs.writeFile(inputPath, buffer);
		try {
			await new Promise<void>((resolve, reject) => {
				const processHandle = spawn(
					executable,
					[
						'-y',
						'-i',
						inputPath,
						'-vn',
						'-ac',
						'1',
						'-ar',
						'48000',
						'-c:a',
						'libopus',
						'-b:a',
						'32k',
						'-application',
						'voip',
						'-f',
						'ogg',
						outputPath,
					],
					{ windowsHide: true },
				);
				let stderr = '';
				const timer = setTimeout(() => {
					processHandle.kill();
					reject(new Error('Voice conversion timed out'));
				}, 30000);
				processHandle.stderr?.on('data', (chunk: Buffer) => {
					stderr = `${stderr}${chunk.toString()}`.slice(-2000);
				});
				processHandle.once('error', (error: Error) => {
					clearTimeout(timer);
					reject(error);
				});
				processHandle.once('close', (code: number) => {
					clearTimeout(timer);
					if (code === 0) resolve();
					else reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
				});
			});
			const out = await fs.readFile(outputPath);
			if (!out.length) throw new Error('Converted voice file is empty');
			return {
				buffer: out,
				mimeType: 'audio/ogg',
				fileName: `${path.parse(fileName).name || 'voice'}.ogg`,
			};
		} finally {
			await fs.rm(inputPath, { force: true }).catch(() => {});
			await fs.rm(outputPath, { force: true }).catch(() => {});
		}
	}
}
