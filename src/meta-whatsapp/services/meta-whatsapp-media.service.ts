import { Injectable, NotFoundException } from '@nestjs/common';
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
}
