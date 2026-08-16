import {
	BadRequestException,
	Injectable,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Repository } from 'typeorm';
import { User } from '../../../entities/global.entity';
import {
	WhatsAppMessageAttachment,
	WhatsAppSavedSticker,
} from '../entities/whatsapp.entity';
import { runFfmpeg } from '../utils/whatsapp-voice-ogg';
import { WhatsAppAccessService } from './whatsapp-access.service';

export type StickerUpload = {
	mimetype: string;
	originalname: string;
	path: string;
	size: number;
};

const STICKER_EDGE = 512;
const STICKER_TARGET_BYTES = 480 * 1024;
const STICKER_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const STICKER_LIBRARY_LIMIT = 400;
const STICKER_SYNC_LIMIT = 500;

function mediaRoot() {
	return path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);
}

function hashBuffer(buffer: Buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

function isAnimatedWebp(buffer: Buffer) {
	return buffer.includes(Buffer.from('ANIM')) || buffer.includes(Buffer.from('ANMF'));
}

@Injectable()
export class WhatsAppStickersService {
	constructor(
		@InjectRepository(WhatsAppSavedSticker)
		private readonly stickerRepo: Repository<WhatsAppSavedSticker>,
		@InjectRepository(WhatsAppMessageAttachment)
		private readonly attachmentRepo: Repository<WhatsAppMessageAttachment>,
		private readonly access: WhatsAppAccessService,
	) {}

	async list(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const rows = await this.stickerRepo.find({
			where: { accountId },
			order: { created_at: 'DESC' },
			take: STICKER_LIBRARY_LIMIT,
		});
		return {
			items: rows.map((row) => this.toDto(row)),
		};
	}

	async addUpload(user: User, accountId: string, file: StickerUpload) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		if (!file?.path) throw new BadRequestException('Sticker file is required');
		if (file.size > STICKER_UPLOAD_MAX_BYTES) {
			throw new BadRequestException('Sticker source must be under 15 MB');
		}
		const original = await fs.readFile(file.path);
		if (!original.length) throw new BadRequestException('Sticker file is empty');
		const prepared = await this.minimizeSticker(
			original,
			file.originalname,
			file.mimetype,
			file.path,
		);
		try {
			return this.savePrepared(user, accountId, {
				originalBuffer: original,
				storedBuffer: prepared.buffer,
				mimeType: prepared.mimeType,
				fileName: prepared.fileName,
				source: 'upload',
				isAnimated: prepared.isAnimated,
			});
		} finally {
			await fs.rm(prepared.tempPath || '', { force: true }).catch(() => undefined);
		}
	}

	async syncFromHistory(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const attachments = await this.attachmentRepo
			.createQueryBuilder('attachment')
			.innerJoin('attachment.message', 'message')
			.where('message.accountId = :accountId', { accountId })
			.andWhere('attachment.type = :type', { type: 'sticker' })
			.andWhere('attachment.downloadStatus = :status', { status: 'downloaded' })
			.andWhere('attachment.storagePath IS NOT NULL')
			.orderBy('attachment.created_at', 'DESC')
			.take(STICKER_SYNC_LIMIT)
			.getMany();
		let imported = 0;
		let skipped = 0;
		for (const attachment of attachments) {
			const absolutePath = this.resolveStoredPath(attachment.storagePath);
			if (!absolutePath) {
				skipped += 1;
				continue;
			}
			try {
				const original = await fs.readFile(absolutePath);
				if (!original.length) {
					skipped += 1;
					continue;
				}
				const prepared = await this.minimizeSticker(
					original,
					attachment.fileName || 'sticker.webp',
					attachment.mimeType || 'image/webp',
					absolutePath,
				);
				try {
					const saved = await this.savePrepared(user, accountId, {
						originalBuffer: original,
						storedBuffer: prepared.buffer,
						mimeType: prepared.mimeType,
						fileName: prepared.fileName,
						source: 'history',
						isAnimated: prepared.isAnimated,
					});
					if (saved.created) imported += 1;
				} finally {
					await fs.rm(prepared.tempPath || '', { force: true }).catch(() => undefined);
				}
			} catch {
				skipped += 1;
			}
		}
		const list = await this.list(user, accountId);
		return { imported, skipped, processed: attachments.length, ...list };
	}

	async remove(user: User, accountId: string, stickerId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const row = await this.stickerRepo.findOne({ where: { id: stickerId, accountId } });
		if (!row) throw new NotFoundException('Sticker not found');
		const absolutePath = this.resolveStoredPath(row.storagePath);
		await this.stickerRepo.softRemove(row);
		if (absolutePath && absolutePath.includes(`${path.sep}stickers${path.sep}`)) {
			await fs.rm(absolutePath, { force: true }).catch(() => undefined);
		}
		return { deleted: true };
	}

	async stream(user: User, accountId: string, stickerId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canView');
		const row = await this.stickerRepo.findOne({ where: { id: stickerId, accountId } });
		if (!row) throw new NotFoundException('Sticker not found');
		const absolutePath = this.resolveStoredPath(row.storagePath);
		if (!absolutePath) throw new NotFoundException('Sticker file is missing');
		await fs.access(absolutePath);
		return {
			absolutePath,
			mimeType: row.mimeType || 'image/webp',
			fileName: row.fileName || 'sticker.webp',
			stream: createReadStream(absolutePath),
		};
	}

	private async savePrepared(
		user: User,
		accountId: string,
		input: {
			originalBuffer: Buffer;
			storedBuffer: Buffer;
			mimeType: string;
			fileName: string;
			source: 'upload' | 'history';
			isAnimated: boolean;
		},
	) {
		const originalHash = hashBuffer(input.originalBuffer);
		const storedHash = hashBuffer(input.storedBuffer);
		const existing =
			(await this.stickerRepo.findOne({
				where: { accountId, fileHash: originalHash },
				withDeleted: true,
			})) ||
			(await this.stickerRepo.findOne({
				where: { accountId, fileHash: storedHash },
				withDeleted: true,
			}));
		if (existing && !existing.deleted_at) {
			return { ...this.toDto(existing), created: false };
		}
		const folder = path.join(mediaRoot(), 'stickers', accountId, user.id);
		await fs.mkdir(folder, { recursive: true });
		const extension = this.extensionForMime(input.mimeType);
		const storedName = `${originalHash.slice(0, 16)}${extension}`;
		const absolutePath = path.join(folder, storedName);
		if (!(await this.exists(absolutePath))) {
			await fs.writeFile(absolutePath, input.storedBuffer);
		}
		const storagePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');
		if (existing?.deleted_at) {
			await this.stickerRepo.recover(existing);
			existing.fileHash = originalHash;
			existing.storagePath = storagePath;
			existing.mimeType = input.mimeType;
			existing.fileName = input.fileName;
			existing.source = input.source;
			existing.isAnimated = input.isAnimated;
			await this.stickerRepo.save(existing);
			return { ...this.toDto(existing), created: false };
		}
		const row = this.stickerRepo.create({
			accountId,
			userId: user.id,
			fileHash: originalHash,
			mimeType: input.mimeType,
			fileName: input.fileName,
			storagePath,
			source: input.source,
			isAnimated: input.isAnimated,
		});
		await this.stickerRepo.save(row);
		return { ...this.toDto(row), created: true };
	}

	private isAnimatedSticker(buffer: Buffer, mimeType: string, fileName: string) {
		const mime = String(mimeType || '').toLowerCase();
		const name = String(fileName || '').toLowerCase();
		if (mime.includes('gif') || name.endsWith('.gif')) return true;
		if (mime.includes('webp') || name.endsWith('.webp')) return isAnimatedWebp(buffer);
		return false;
	}

	private alreadySmallEnough(buffer: Buffer, mimeType: string, animated: boolean) {
		const mime = String(mimeType || '').toLowerCase();
		const isWebp = mime.includes('webp');
		if (!isWebp) return false;
		if (animated) return buffer.length <= STICKER_TARGET_BYTES;
		return buffer.length <= STICKER_TARGET_BYTES;
	}

	private async minimizeSticker(
		buffer: Buffer,
		originalName: string,
		mimeType: string,
		existingPath?: string,
	) {
		const animated = this.isAnimatedSticker(buffer, mimeType, originalName);
		const fileName = String(originalName || 'sticker').replace(/\.[^.]+$/, '.webp');
		if (this.alreadySmallEnough(buffer, mimeType, animated)) {
			return {
				buffer,
				mimeType: String(mimeType || '').includes('gif') ? 'image/gif' : 'image/webp',
				fileName: originalName || (animated ? 'sticker.webp' : 'sticker.webp'),
				tempPath: '',
				isAnimated: animated,
			};
		}

		const inputPath =
			existingPath && (await this.exists(existingPath))
				? existingPath
				: path.join(tmpdir(), `wa-sticker-in-${randomUUID()}${this.extensionForMime(mimeType)}`);
		const wroteTempInput = inputPath !== existingPath;
		if (wroteTempInput) await fs.writeFile(inputPath, buffer);
		try {
			const compressed = await this.compressToWebp(inputPath, animated);
			return {
				buffer: compressed.buffer,
				mimeType: 'image/webp',
				fileName,
				tempPath: compressed.outputPath,
				isAnimated: animated,
			};
		} catch {
			if (buffer.length > STICKER_TARGET_BYTES * 2) {
				throw new BadRequestException('Could not compress this sticker');
			}
			return {
				buffer,
				mimeType: mimeType || 'image/png',
				fileName: originalName || 'sticker.png',
				tempPath: '',
				isAnimated: animated,
			};
		} finally {
			if (wroteTempInput) await fs.rm(inputPath, { force: true }).catch(() => undefined);
		}
	}

	private scaleFilter(animated: boolean) {
		const fitted = `scale=${STICKER_EDGE}:${STICKER_EDGE}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${STICKER_EDGE}:${STICKER_EDGE}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
		return animated ? `${fitted},fps=12` : fitted;
	}

	private async compressToWebp(inputPath: string, animated: boolean) {
		const qualities = animated ? [55, 40, 28] : [70, 55, 40, 28];
		let lastOutput = '';
		let lastBuffer: Buffer | null = null;
		for (const quality of qualities) {
			const outputPath = `${inputPath}.q${quality}.webp`;
			if (lastOutput && lastOutput !== outputPath) {
				await fs.rm(lastOutput, { force: true }).catch(() => undefined);
			}
			lastOutput = outputPath;
			const args = [
				'-y',
				'-i',
				inputPath,
				'-vf',
				this.scaleFilter(animated),
				'-vcodec',
				'libwebp',
				'-lossless',
				'0',
				'-compression_level',
				'6',
				'-q:v',
				String(quality),
				'-an',
				...(animated ? ['-loop', '0'] : ['-frames:v', '1']),
				outputPath,
			];
			try {
				await runFfmpeg(args, animated ? 45_000 : 20_000);
				lastBuffer = await fs.readFile(outputPath);
				if (lastBuffer.length <= STICKER_TARGET_BYTES || quality === qualities[qualities.length - 1]) {
					return { buffer: lastBuffer, outputPath };
				}
			} catch {
				await fs.rm(outputPath, { force: true }).catch(() => undefined);
			}
		}
		if (lastBuffer?.length) return { buffer: lastBuffer, outputPath: lastOutput };
		throw new Error('Could not compress sticker');
	}

	private extensionForMime(mimeType: string) {
		if (String(mimeType || '').includes('gif')) return '.gif';
		if (String(mimeType || '').includes('png')) return '.png';
		if (String(mimeType || '').includes('jpeg') || String(mimeType || '').includes('jpg')) {
			return '.jpg';
		}
		return '.webp';
	}

	private resolveStoredPath(storagePath: string | null) {
		if (!storagePath) return null;
		const absolutePath = path.resolve(process.cwd(), String(storagePath).replace(/^\/+/, ''));
		const allowed = [mediaRoot(), path.resolve(process.cwd(), 'uploads', 'whatsapp-media')];
		if (allowed.some((root) => absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`))) {
			return absolutePath;
		}
		return null;
	}

	private async exists(filePath: string) {
		try {
			await fs.access(filePath);
			return true;
		} catch {
			return false;
		}
	}

	private toDto(row: WhatsAppSavedSticker) {
		return {
			id: row.id,
			source: row.source,
			mimeType: row.mimeType,
			fileName: row.fileName,
			isAnimated: Boolean(row.isAnimated),
			canDelete: true,
			url: `/whatsapp/accounts/${row.accountId}/stickers/${row.id}/content`,
			createdAt: row.created_at,
		};
	}
}
