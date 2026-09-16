import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { IsNull, Repository } from 'typeorm';
import type { User } from '../../../entities/global.entity';
import {
	WhatsAppMediaLibraryFolder,
	WhatsAppMediaLibraryItem,
} from '../entities/whatsapp.entity';
import { WhatsAppSyncService } from './whatsapp-sync.service';
import { WhatsAppVoiceEditorService } from './whatsapp-voice-editor.service';
import { probeAudioSeconds } from '../utils/whatsapp-voice-ogg';
import {
	MAX_LIBRARY_FOLDERS_PER_USER,
	MAX_LIBRARY_ITEMS_PER_USER,
	defaultItemTitle,
	libraryFileExtension,
	libraryMediaType,
	libraryStorageRelativePath,
	normalizeFolderName,
	normalizeItemTitle,
	resolveLibraryPathInsideRoot,
} from '../utils/whatsapp-media-library';

function mediaRoot() {
	return path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);
}

/**
 * The saved-media library: a per-user store of media that is deliberately
 * independent of any conversation.
 *
 * Every item owns its own copy of the file under `<media root>/library/<user>/`, so
 * clearing a chat, deleting a message, or losing the original attachment does not
 * break playback or re-sending. That copy is the whole point — a converted voice
 * note must be re-sendable without re-running FFmpeg or the AI isolation.
 */
@Injectable()
export class WhatsAppMediaLibraryService {
	constructor(
		@InjectRepository(WhatsAppMediaLibraryFolder)
		private readonly folderRepo: Repository<WhatsAppMediaLibraryFolder>,
		@InjectRepository(WhatsAppMediaLibraryItem)
		private readonly itemRepo: Repository<WhatsAppMediaLibraryItem>,
		private readonly sync: WhatsAppSyncService,
		private readonly voiceEditor: WhatsAppVoiceEditorService,
	) {}

	// ---------------------------------------------------------------- folders

	async listFolders(user: User) {
		const folders = await this.folderRepo.find({
			where: { userId: user.id },
			order: { name: 'ASC' },
		});
		const counts = await this.itemRepo
			.createQueryBuilder('item')
			.select('item.folder_id', 'folderId')
			.addSelect('COUNT(*)', 'count')
			.where('item.user_id = :userId', { userId: user.id })
			.andWhere('item.deleted_at IS NULL')
			.groupBy('item.folder_id')
			.getRawMany<{ folderId: string | null; count: string }>();

		const countByFolder = new Map(
			counts.map((row) => [row.folderId || '', Number(row.count) || 0]),
		);
		return {
			// The root is not a row; it is where items with no folder live.
			rootCount: countByFolder.get('') || 0,
			folders: folders.map((folder) => ({
				id: folder.id,
				name: folder.name,
				itemCount: countByFolder.get(folder.id) || 0,
				createdAt: folder.created_at,
			})),
		};
	}

	async createFolder(user: User, rawName: unknown) {
		const name = normalizeFolderName(rawName);
		if (!name) throw new BadRequestException('Folder name is required');

		const total = await this.folderRepo.count({ where: { userId: user.id } });
		if (total >= MAX_LIBRARY_FOLDERS_PER_USER) {
			throw new BadRequestException(`You can keep up to ${MAX_LIBRARY_FOLDERS_PER_USER} folders`);
		}
		const existing = await this.findFolderByName(user, name);
		// Creating a folder that already exists is what "save into Converted Voices"
		// does on the second save, so treat it as a lookup instead of an error.
		if (existing) return { id: existing.id, name: existing.name, created: false };

		const folder = await this.folderRepo.save(
			this.folderRepo.create({ userId: user.id, name }),
		);
		return { id: folder.id, name: folder.name, created: true };
	}

	async renameFolder(user: User, folderId: string, rawName: unknown) {
		const name = normalizeFolderName(rawName);
		if (!name) throw new BadRequestException('Folder name is required');
		const folder = await this.assertFolder(user, folderId);
		const clash = await this.findFolderByName(user, name);
		if (clash && clash.id !== folder.id) {
			throw new BadRequestException('A folder with this name already exists');
		}
		folder.name = name;
		await this.folderRepo.save(folder);
		return { id: folder.id, name: folder.name };
	}

	/** Soft-deletes the folder; its items fall back to the library root. */
	async deleteFolder(user: User, folderId: string) {
		const folder = await this.assertFolder(user, folderId);
		await this.itemRepo.update({ userId: user.id, folderId: folder.id }, { folderId: null });
		await this.folderRepo.softRemove(folder);
		return { deleted: true };
	}

	// ------------------------------------------------------------------ items

	async listItems(user: User, folderId?: string | null) {
		const scope =
			folderId === undefined
				? {}
				: { folderId: folderId ? folderId : IsNull() };
		if (folderId) await this.assertFolder(user, folderId);

		const items = await this.itemRepo.find({
			where: { userId: user.id, ...scope },
			order: { created_at: 'DESC' },
		});
		return { items: items.map((item) => this.toPublicItem(item)) };
	}

	/** Saves an existing chat attachment into the library. */
	async saveAttachment(
		user: User,
		attachmentId: string,
		options: { folderId?: string | null; title?: string } = {},
	) {
		const attachment = await this.sync.assertAttachmentVisible(user, attachmentId);
		const mediaType = libraryMediaType(attachment.type);
		if (!mediaType) {
			throw new BadRequestException('This message type cannot be saved to the library');
		}
		const folderId = await this.resolveFolderId(user, options.folderId);
		const source = await this.sync.resolveAttachmentFile(user, attachmentId);

		const durationSeconds =
			mediaType === 'voice' || mediaType === 'audio'
				? Math.round(await probeAudioSeconds(source.absolutePath).catch(() => 0)) || null
				: null;

		return this.storeItem(user, source.absolutePath, {
			folderId,
			mediaType,
			mimeType: source.mimeType || attachment.mimeType || 'application/octet-stream',
			fileName: source.fileName || attachment.fileName || null,
			title:
				normalizeItemTitle(
					options.title,
					defaultItemTitle(mediaType, attachment.fileName, durationSeconds),
				) || defaultItemTitle(mediaType, attachment.fileName, durationSeconds),
			durationSeconds,
			source: 'attachment',
			sourceAttachmentId: attachment.id,
			sourceConversationId: attachment.message?.conversationId || null,
			copy: true,
		});
	}

	/**
	 * Renders the voice editor's output and saves it, without sending. This is the
	 * "keep the converted voice" path: the expensive work happens once.
	 */
	async saveVoiceEdit(
		user: User,
		attachmentId: string,
		editOptions: unknown,
		options: { folderId?: string | null; title?: string } = {},
	) {
		const folderId = await this.resolveFolderId(user, options.folderId);
		const prepared = await this.voiceEditor.render(user, attachmentId, editOptions, 'ogg');
		try {
			const attachment = await this.sync.assertAttachmentVisible(user, attachmentId).catch(() => null);
			return await this.storeItem(user, prepared.filePath, {
				folderId,
				mediaType: 'voice',
				mimeType: 'audio/ogg; codecs=opus',
				fileName: `voice-${prepared.seconds}s.ogg`,
				title: normalizeItemTitle(
					options.title,
					defaultItemTitle('voice', null, prepared.seconds),
				),
				durationSeconds: prepared.seconds,
				source: 'voice_edit',
				sourceAttachmentId: attachmentId,
				sourceConversationId: attachment?.message?.conversationId || null,
				// The render already produced a private temp file, so move it in.
				copy: false,
			});
		} finally {
			// `storeItem` renames the temp file when `copy` is false; cleanup is then a
			// no-op, and on failure it removes the leftover.
			await prepared.cleanup().catch(() => undefined);
		}
	}

	async updateItem(
		user: User,
		itemId: string,
		changes: { title?: unknown; folderId?: string | null },
	) {
		const item = await this.assertItem(user, itemId);
		if (changes.title !== undefined) {
			item.title = normalizeItemTitle(changes.title, item.title);
		}
		if (changes.folderId !== undefined) {
			item.folderId = await this.resolveFolderId(user, changes.folderId);
		}
		await this.itemRepo.save(item);
		return this.toPublicItem(item);
	}

	async deleteItem(user: User, itemId: string) {
		const item = await this.assertItem(user, itemId);
		await this.itemRepo.softRemove(item);
		// The row is kept for audit/undo purposes but the bytes are not: a library of
		// deleted media would grow without bound.
		const absolute = resolveLibraryPathInsideRoot(mediaRoot(), item.storagePath);
		if (absolute) await fs.rm(absolute, { force: true }).catch(() => undefined);
		return { deleted: true };
	}

	/** Absolute path for streaming, after verifying ownership and path safety. */
	async resolveItemFile(user: User, itemId: string) {
		const item = await this.assertItem(user, itemId);
		const absolute = resolveLibraryPathInsideRoot(mediaRoot(), item.storagePath);
		if (!absolute) throw new NotFoundException('Saved media file is unavailable');
		await fs.access(absolute).catch(() => {
			throw new NotFoundException('Saved media file is no longer on disk');
		});
		return { item, absolutePath: absolute };
	}

	/** Re-sends a saved item to any conversation — no re-conversion. */
	async sendItem(
		user: User,
		itemId: string,
		conversationId: string,
		options: { clientMessageId?: string } = {},
	) {
		const { item, absolutePath } = await this.resolveItemFile(user, itemId);

		if (item.mediaType === 'voice') {
			const result = await this.sync.sendVoiceFromFile(user, conversationId, absolutePath, {
				seconds: item.durationSeconds || undefined,
				clientMessageId: options.clientMessageId,
			});
			await this.itemRepo.update(item.id, { lastSentAt: new Date() });
			return result;
		}

		const result = await this.sync.sendMediaFromFile(user, conversationId, absolutePath, {
			type: item.mediaType,
			fileName: item.fileName || undefined,
			clientMessageId: options.clientMessageId,
		});
		await this.itemRepo.update(item.id, { lastSentAt: new Date() });
		return result;
	}

	// -------------------------------------------------------------- internals

	private toPublicItem(item: WhatsAppMediaLibraryItem) {
		return {
			id: item.id,
			folderId: item.folderId,
			title: item.title,
			mediaType: item.mediaType,
			mimeType: item.mimeType,
			fileName: item.fileName,
			fileSizeBytes: item.fileSizeBytes == null ? null : Number(item.fileSizeBytes),
			durationSeconds: item.durationSeconds,
			source: item.source,
			sourceConversationId: item.sourceConversationId,
			lastSentAt: item.lastSentAt,
			createdAt: item.created_at,
		};
	}

	private async findFolderByName(user: User, name: string) {
		return this.folderRepo
			.createQueryBuilder('folder')
			.where('folder.user_id = :userId', { userId: user.id })
			.andWhere('LOWER(folder.name) = LOWER(:name)', { name })
			.andWhere('folder.deleted_at IS NULL')
			.getOne();
	}

	private async assertFolder(user: User, folderId: string) {
		const folder = await this.folderRepo.findOne({
			where: { id: folderId, userId: user.id },
		});
		if (!folder) throw new NotFoundException('Library folder not found');
		return folder;
	}

	private async assertItem(user: User, itemId: string) {
		const item = await this.itemRepo.findOne({ where: { id: itemId, userId: user.id } });
		if (!item) throw new NotFoundException('Saved media not found');
		return item;
	}

	/** Accepts a folder id or a new folder name, and verifies ownership. */
	private async resolveFolderId(user: User, folderId?: string | null) {
		if (!folderId) return null;
		const folder = await this.assertFolder(user, folderId);
		return folder.id;
	}

	private async storeItem(
		user: User,
		sourceAbsolutePath: string,
		details: {
			folderId: string | null;
			mediaType: string;
			mimeType: string;
			fileName: string | null;
			title: string;
			durationSeconds: number | null;
			source: string;
			sourceAttachmentId: string | null;
			sourceConversationId: string | null;
			copy: boolean;
		},
	) {
		const total = await this.itemRepo.count({ where: { userId: user.id } });
		if (total >= MAX_LIBRARY_ITEMS_PER_USER) {
			throw new BadRequestException(
				`Your library is full (${MAX_LIBRARY_ITEMS_PER_USER} items). Delete something first.`,
			);
		}

		const extension = libraryFileExtension(details.fileName, details.mimeType, details.mediaType);
		const relative = libraryStorageRelativePath(user.id, details.mediaType, extension);
		const absolute = resolveLibraryPathInsideRoot(mediaRoot(), relative);
		if (!absolute) throw new BadRequestException('Could not build a storage path for this item');

		await fs.mkdir(path.dirname(absolute), { recursive: true });
		if (details.copy) {
			await fs.copyFile(sourceAbsolutePath, absolute);
		} else {
			// Same-volume rename where possible; fall back to copy across devices.
			await fs.rename(sourceAbsolutePath, absolute).catch(async () => {
				await fs.copyFile(sourceAbsolutePath, absolute);
				await fs.rm(sourceAbsolutePath, { force: true }).catch(() => undefined);
			});
		}

		const stat = await fs.stat(absolute).catch(() => null);

		try {
			const item = await this.itemRepo.save(
				this.itemRepo.create({
					userId: user.id,
					folderId: details.folderId,
					title: details.title,
					mediaType: details.mediaType,
					mimeType: details.mimeType,
					fileName: details.fileName,
					storagePath: relative,
					fileSizeBytes: stat ? String(stat.size) : null,
					durationSeconds: details.durationSeconds,
					source: details.source,
					sourceAttachmentId: details.sourceAttachmentId,
					sourceConversationId: details.sourceConversationId,
				}),
			);
			return this.toPublicItem(item);
		} catch (error) {
			// Never leave an orphan file behind a failed insert.
			await fs.rm(absolute, { force: true }).catch(() => undefined);
			throw error;
		}
	}
}
