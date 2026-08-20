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
import { isPathInside, mediaFileCandidates } from '../utils/whatsapp-sticker-path';
import { runFfmpeg } from '../utils/whatsapp-voice-ogg';
import { WhatsAppAccessService } from './whatsapp-access.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';

export type StickerUpload = {
	mimetype: string;
	originalname: string;
	path: string;
	size: number;
};

const STICKER_EDGE = 512;
const STICKER_TARGET_BYTES = 480 * 1024;
const STICKER_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const STICKER_LIBRARY_LIMIT = 2000;
const STICKER_SYNC_PAGE = 250;
const STICKER_SYNC_MAX = 2500;
const STICKER_SYNC_DOWNLOADS = 40;

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
		private readonly sync: WhatsAppSyncService,
	) {}

	private historyHashIndex = new Map<
		string,
		Promise<Map<string, { absolutePath: string; mimeType: string; fileName: string }>>
	>();
	private libraryPrefixIndex = new Map<string, Promise<Map<string, string>>>();
	private healQueue: Promise<void> = Promise.resolve();

	async list(user: User, accountId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const rows = await this.stickerRepo.find({
			where: { accountId },
			order: { created_at: 'DESC' },
			take: STICKER_LIBRARY_LIMIT,
		});
		const items = [];
		for (const row of rows) {
			const available = Boolean(await this.resolveExistingPath(row.storagePath, row));
			items.push({ ...this.toDto(row), available });
		}
		return { items };
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
		const attachments = await this.listStickerAttachments(accountId, STICKER_SYNC_MAX);
		let imported = 0;
		let repaired = 0;
		let skipped = 0;
		let downloaded = 0;
		let pending = 0;
		let downloadsLeft = STICKER_SYNC_DOWNLOADS;
		for (const attachment of attachments) {
			let storagePath = attachment.storagePath;
			let absolutePath = await this.resolveExistingPath(storagePath);
			if (!absolutePath && downloadsLeft > 0) {
				downloadsLeft -= 1;
				const pulled = await this.sync.tryDownloadAttachmentQuiet(user, attachment.id);
				if (pulled?.ok && pulled.path) {
					downloaded += 1;
					storagePath = pulled.path;
					absolutePath = await this.resolveExistingPath(storagePath);
				}
			}
			if (!absolutePath) {
				pending += 1;
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
					else if (saved.repaired) repaired += 1;
				} finally {
					await fs.rm(prepared.tempPath || '', { force: true }).catch(() => undefined);
				}
			} catch {
				skipped += 1;
			}
		}
		this.historyHashIndex.delete(accountId);
		this.libraryPrefixIndex.delete(accountId);
		const list = await this.list(user, accountId);
		return {
			imported,
			repaired,
			skipped,
			downloaded,
			pending,
			processed: attachments.length,
			...list,
		};
	}

	private stickerHistoryQuery(accountId: string) {
		return this.attachmentRepo
			.createQueryBuilder('attachment')
			.innerJoin('attachment.message', 'message')
			.where('message.accountId = :accountId', { accountId })
			.andWhere('(attachment.type = :sticker OR message.type = :sticker)', {
				sticker: 'sticker',
			})
			.orderBy('attachment.created_at', 'DESC');
	}

	private async listStickerAttachments(accountId: string, limit: number) {
		const items: WhatsAppMessageAttachment[] = [];
		for (let skip = 0; skip < limit; skip += STICKER_SYNC_PAGE) {
			const page = await this.stickerHistoryQuery(accountId)
				.skip(skip)
				.take(Math.min(STICKER_SYNC_PAGE, limit - skip))
				.getMany();
			items.push(...page);
			if (page.length < STICKER_SYNC_PAGE) break;
		}
		const seen = new Set<string>();
		return items.filter((item) => {
			if (seen.has(item.id)) return false;
			seen.add(item.id);
			return true;
		});
	}

	async remove(user: User, accountId: string, stickerId: string) {
		await this.access.assertAccountPermission(user, accountId, 'canUse');
		const row = await this.stickerRepo.findOne({ where: { id: stickerId, accountId } });
		if (!row) throw new NotFoundException('Sticker not found');
		const absolutePath = await this.resolveExistingPath(row.storagePath, row);
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
		let absolutePath = await this.resolveExistingPath(row.storagePath, row);
		if (!absolutePath) {
			absolutePath = await this.healLibraryFile(row);
		}
		if (!absolutePath) throw new NotFoundException('Sticker file is missing');
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
		const missingOnDisk =
			existing && !existing.deleted_at
				? !(await this.resolveExistingPath(existing.storagePath, existing))
				: false;
		if (existing && !existing.deleted_at && !missingOnDisk) {
			return { ...this.toDto(existing), created: false, repaired: false };
		}
		const written = await this.writeLibraryFile(
			accountId,
			existing?.userId || user.id,
			originalHash,
			input.storedBuffer,
			input.mimeType,
		);
		if (existing?.deleted_at) {
			await this.stickerRepo.recover(existing);
		}
		if (existing) {
			existing.fileHash = originalHash;
			existing.storagePath = written.storagePath;
			existing.mimeType = input.mimeType;
			existing.fileName = input.fileName;
			existing.source = input.source;
			existing.isAnimated = input.isAnimated;
			await this.stickerRepo.save(existing);
			return { ...this.toDto(existing), created: false, repaired: missingOnDisk };
		}
		const row = this.stickerRepo.create({
			accountId,
			userId: user.id,
			fileHash: originalHash,
			mimeType: input.mimeType,
			fileName: input.fileName,
			storagePath: written.storagePath,
			source: input.source,
			isAnimated: input.isAnimated,
		});
		await this.stickerRepo.save(row);
		return { ...this.toDto(row), created: true, repaired: false };
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

	private libraryFileName(fileHash: string, mimeType: string) {
		return `${fileHash.slice(0, 16)}${this.extensionForMime(mimeType)}`;
	}

	private libraryRelativePath(accountId: string, userId: string, fileHash: string, mimeType: string) {
		return ['stickers', accountId, userId, this.libraryFileName(fileHash, mimeType)].join('/');
	}

	private async writeLibraryFile(
		accountId: string,
		userId: string,
		fileHash: string,
		buffer: Buffer,
		mimeType: string,
	) {
		const folder = path.join(mediaRoot(), 'stickers', accountId, userId);
		await fs.mkdir(folder, { recursive: true });
		const absolutePath = path.join(folder, this.libraryFileName(fileHash, mimeType));
		await fs.writeFile(absolutePath, buffer);
		this.libraryPrefixIndex.delete(accountId);
		return {
			absolutePath,
			storagePath: this.libraryRelativePath(accountId, userId, fileHash, mimeType),
		};
	}

	private allowedMediaRoots() {
		return [mediaRoot(), path.resolve(process.cwd(), 'uploads', 'whatsapp-media')];
	}

	private async resolveExistingPath(storagePath: string | null, row?: WhatsAppSavedSticker) {
		const roots = this.allowedMediaRoots();
		const extra = row
			? [
					path.join(mediaRoot(), this.libraryRelativePath(row.accountId, row.userId, row.fileHash, row.mimeType)),
				]
			: [];
		const candidates = [
			...mediaFileCandidates(storagePath || '', {
				cwd: process.cwd(),
				mediaRoot: mediaRoot(),
				extraRoots: roots,
			}),
			...extra,
		];
		const seen = new Set<string>();
		for (const candidate of candidates) {
			if (seen.has(candidate)) continue;
			seen.add(candidate);
			if (!roots.some((root) => isPathInside(candidate, root))) continue;
			if (await this.exists(candidate)) return candidate;
		}
		if (row) {
			const found = await this.findLibraryFileByHash(row);
			if (found) return found;
		}
		return null;
	}

	private loadLibraryPrefixIndex(accountId: string) {
		const cached = this.libraryPrefixIndex.get(accountId);
		if (cached) return cached;
		const pending = this.buildLibraryPrefixIndex(accountId);
		this.libraryPrefixIndex.set(accountId, pending);
		return pending;
	}

	private async buildLibraryPrefixIndex(accountId: string) {
		const index = new Map<string, string>();
		const accountFolder = path.join(mediaRoot(), 'stickers', accountId);
		if (!(await this.exists(accountFolder))) return index;
		try {
			const users = await fs.readdir(accountFolder, { withFileTypes: true });
			for (const userDir of users) {
				if (!userDir.isDirectory()) continue;
				const folder = path.join(accountFolder, userDir.name);
				const files = await fs.readdir(folder);
				for (const name of files) {
					const prefix = name.slice(0, 16).toLowerCase();
					const absolutePath = path.join(folder, name);
					if (!isPathInside(absolutePath, mediaRoot())) continue;
					if (!index.has(prefix)) index.set(prefix, absolutePath);
				}
			}
		} catch {
			return index;
		}
		return index;
	}

	private async findLibraryFileByHash(row: WhatsAppSavedSticker) {
		const index = await this.loadLibraryPrefixIndex(row.accountId);
		const absolutePath = index.get(row.fileHash.slice(0, 16).toLowerCase());
		if (!absolutePath || !(await this.exists(absolutePath))) return null;
		if (!isPathInside(absolutePath, mediaRoot())) return null;
		return absolutePath;
	}

	private loadHistoryIndex(accountId: string) {
		const cached = this.historyHashIndex.get(accountId);
		if (cached) return cached;
		const pending = this.buildHistoryIndex(accountId);
		this.historyHashIndex.set(accountId, pending);
		return pending;
	}

	private async buildHistoryIndex(accountId: string) {
		const attachments = await this.listStickerAttachments(accountId, STICKER_SYNC_MAX);
		const byHash = new Map<string, { absolutePath: string; mimeType: string; fileName: string }>();
		for (const attachment of attachments) {
			const absolutePath = await this.resolveExistingPath(attachment.storagePath);
			if (!absolutePath) continue;
			try {
				const original = await fs.readFile(absolutePath);
				if (!original.length) continue;
				const hash = hashBuffer(original);
				if (!byHash.has(hash)) {
					byHash.set(hash, {
						absolutePath,
						mimeType: attachment.mimeType || 'image/webp',
						fileName: attachment.fileName || 'sticker.webp',
					});
				}
			} catch {
				continue;
			}
		}
		return byHash;
	}

	private async healLibraryFile(row: WhatsAppSavedSticker) {
		let healed: string | null = null;
		this.healQueue = this.healQueue.catch(() => undefined).then(async () => {
			const existing = await this.resolveExistingPath(row.storagePath, row);
			if (existing) {
				healed = existing;
				return;
			}
			const index = await this.loadHistoryIndex(row.accountId);
			const match = index.get(row.fileHash);
			if (!match) return;
			const original = await fs.readFile(match.absolutePath);
			const prepared = await this.minimizeSticker(
				original,
				match.fileName,
				match.mimeType,
				match.absolutePath,
			);
			try {
				const written = await this.writeLibraryFile(
					row.accountId,
					row.userId,
					row.fileHash,
					prepared.buffer,
					prepared.mimeType,
				);
				row.storagePath = written.storagePath;
				row.mimeType = prepared.mimeType;
				row.fileName = prepared.fileName || row.fileName;
				row.isAnimated = prepared.isAnimated;
				await this.stickerRepo.save(row);
				healed = written.absolutePath;
			} finally {
				await fs.rm(prepared.tempPath || '', { force: true }).catch(() => undefined);
			}
		});
		await this.healQueue.catch(() => undefined);
		return healed;
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
