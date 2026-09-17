import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import type { User } from '../../../entities/global.entity';
import {
	WhatsAppStoryDraft,
	type WhatsAppStoryDraftPart,
} from '../entities/whatsapp.entity';
import { WhatsAppStatusService } from './whatsapp-status.service';
import { WhatsAppSyncService } from './whatsapp-sync.service';
import { probeAudioSeconds, runFfmpeg } from '../utils/whatsapp-voice-ogg';
import { signMediaToken, signedStoryPartPath } from '../utils/whatsapp-media-signed-url';
import {
	STORY_MAX_SECONDS,
	buildStorySegmentFfmpegArgs,
	describeStoryRejection,
	planStorySegments,
	resolveStoryPathInsideRoot,
	storyPartRelativePath,
} from '../utils/whatsapp-story-video';

function mediaRoot() {
	return path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);
}

/** Preview URL lifetime. The review step is short, but a distracted user is normal. */
const PREVIEW_TTL_SECONDS = 2 * 60 * 60;

/** Cutting is CPU-bound; a very long video would otherwise hold a worker forever. */
const CUT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Publishing a chat video as one or more stories.
 *
 * A story video is capped at 30 seconds by WhatsApp, so anything longer has to be
 * cut. The cut happens up front into a reviewable draft rather than during publish,
 * because the user asked to see the parts before any of them goes out — and because
 * a failure while encoding is recoverable, while a half-published sequence is not.
 *
 * The clips are ordinary files under the media root; publishing hands each one to
 * the existing status publisher in order.
 */
@Injectable()
export class WhatsAppStoryService {
	private readonly logger = new Logger(WhatsAppStoryService.name);
	/** Guards against two publish calls racing over the same draft. */
	private readonly publishing = new Set<string>();

	constructor(
		@InjectRepository(WhatsAppStoryDraft)
		private readonly draftRepo: Repository<WhatsAppStoryDraft>,
		private readonly sync: WhatsAppSyncService,
		private readonly statuses: WhatsAppStatusService,
	) {}

	private serialize(draft: WhatsAppStoryDraft) {
		return {
			id: draft.id,
			accountId: draft.accountId,
			status: draft.status,
			sourceLabel: draft.sourceLabel,
			caption: draft.caption,
			totalDurationSeconds: draft.totalDurationSeconds,
			maxPartSeconds: STORY_MAX_SECONDS,
			errorMessage: draft.errorMessage,
			publishedAt: draft.publishedAt,
			parts: (draft.parts || []).map((part) => ({
				index: part.index,
				startSeconds: part.startSeconds,
				durationSeconds: part.durationSeconds,
				fileSizeBytes: part.fileSizeBytes,
				status: part.status,
				errorMessage: part.errorMessage,
				// Signed: the preview player cannot attach a bearer header.
				url: signedStoryPartPath(
					draft.id,
					part.index,
					signMediaToken(`${draft.id}:${part.index}`, draft.userId, PREVIEW_TTL_SECONDS)
						.token,
				),
			})),
		};
	}

	private async requireDraft(user: User, draftId: string) {
		const draft = await this.draftRepo.findOne({
			where: { id: draftId, userId: user.id },
		});
		if (!draft) throw new NotFoundException('Story draft not found');
		return draft;
	}

	/**
	 * Cuts a chat video into story-length clips and returns them for review.
	 *
	 * Nothing is published here. The draft holds the clips until the user confirms.
	 */
	async prepareFromAttachment(
		user: User,
		accountId: string,
		attachmentId: string,
		caption?: string,
	) {
		await this.statuses.assertCanPublish(user, accountId);
		const attachment = await this.sync.assertAttachmentVisible(user, attachmentId);
		if (!String(attachment.type || '').toLowerCase().includes('video')) {
			throw new BadRequestException('Only a video message can be added to a story');
		}
		const source = await this.sync.resolveAttachmentFile(user, attachmentId);

		const totalSeconds = await probeAudioSeconds(source.absolutePath).catch(() => 0);
		const rejection = describeStoryRejection(totalSeconds);
		if (rejection) throw new BadRequestException(rejection);

		const segments = planStorySegments(totalSeconds);
		if (!segments.length) {
			throw new BadRequestException('This video is too short to publish as a story');
		}

		let draft = this.draftRepo.create({
			userId: user.id,
			accountId,
			sourceAttachmentId: attachment.id,
			sourceLabel: attachment.fileName || null,
			status: 'draft',
			totalDurationSeconds: Math.round(totalSeconds * 100) / 100,
			caption: caption?.trim() || null,
			parts: [],
		});
		draft = await this.draftRepo.save(draft);

		try {
			const parts: WhatsAppStoryDraftPart[] = [];
			for (const segment of segments) {
				const relativePath = storyPartRelativePath(user.id, draft.id, segment.index);
				const absolutePath = resolveStoryPathInsideRoot(mediaRoot(), relativePath);
				if (!absolutePath) throw new Error('Invalid story part storage path');
				await fs.mkdir(path.dirname(absolutePath), { recursive: true });
				await runFfmpeg(
					buildStorySegmentFfmpegArgs(source.absolutePath, absolutePath, segment),
					CUT_TIMEOUT_MS,
				);
				const stat = await fs.stat(absolutePath);
				if (!stat.size) throw new Error(`Story part ${segment.index + 1} came out empty`);
				parts.push({
					index: segment.index,
					startSeconds: segment.startSeconds,
					durationSeconds: segment.durationSeconds,
					storagePath: relativePath,
					fileSizeBytes: stat.size,
					status: 'ready',
					errorMessage: null,
					providerStatusId: null,
				});
			}
			draft.parts = parts;
			draft = await this.draftRepo.save(draft);
			return this.serialize(draft);
		} catch (error: any) {
			// Half-cut clips are useless, and leaving them would be shown as reviewable.
			await this.removeFiles(draft).catch(() => undefined);
			await this.draftRepo.delete(draft.id).catch(() => undefined);
			this.logger.warn(`story prepare failed for ${attachmentId}: ${error?.message || error}`);
			throw new BadRequestException(
				error?.message || 'This video could not be prepared for a story',
			);
		}
	}

	async get(user: User, draftId: string) {
		return this.serialize(await this.requireDraft(user, draftId));
	}

	/** Resolves one prepared clip for streaming, re-checking containment on every read. */
	async resolvePartFile(user: User, draftId: string, index: number) {
		const draft = await this.requireDraft(user, draftId);
		const part = (draft.parts || []).find((entry) => entry.index === index);
		if (!part) throw new NotFoundException('Story part not found');
		const absolutePath = resolveStoryPathInsideRoot(mediaRoot(), part.storagePath);
		if (!absolutePath) throw new NotFoundException('Story part not found');
		const stat = await fs.stat(absolutePath).catch(() => null);
		if (!stat?.isFile()) throw new NotFoundException('Story part is no longer stored');
		return { absolutePath, mimeType: 'video/mp4', size: stat.size };
	}

	/**
	 * Publishes the parts in order, one at a time.
	 *
	 * Sequential on purpose: stories are shown in the order WhatsApp received them,
	 * and parallel uploads would scramble a sliced video. A part that fails stops the
	 * run rather than leaving a gap in the middle of the sequence, and the parts that
	 * already went out stay marked `published` so a retry resumes instead of
	 * re-posting them.
	 */
	async publish(user: User, draftId: string) {
		let draft = await this.requireDraft(user, draftId);
		if (this.publishing.has(draft.id)) return this.serialize(draft);
		if (draft.status === 'published') return this.serialize(draft);
		if (!(draft.parts || []).length) {
			throw new BadRequestException('This draft has no prepared parts');
		}
		await this.statuses.assertCanPublish(user, draft.accountId);

		this.publishing.add(draft.id);
		draft.status = 'publishing';
		draft.errorMessage = null;
		draft = await this.draftRepo.save(draft);

		try {
			const parts = [...(draft.parts || [])].sort((a, b) => a.index - b.index);
			for (const part of parts) {
				if (part.status === 'published') continue;
				const absolutePath = resolveStoryPathInsideRoot(mediaRoot(), part.storagePath);
				if (!absolutePath) throw new Error(`Story part ${part.index + 1} is missing`);

				part.status = 'publishing';
				part.errorMessage = null;
				draft.parts = parts;
				draft = await this.draftRepo.save(draft);

				try {
					const published = await this.statuses.publish(user, draft.accountId, {
						type: 'video',
						content: absolutePath,
						// Only the first clip carries the caption; repeating it on every part
						// reads like a stutter in the story viewer.
						caption: part.index === 0 ? draft.caption || undefined : undefined,
					});
					part.status = 'published';
					part.providerStatusId = published?.providerStatusId || null;
				} catch (error: any) {
					part.status = 'failed';
					part.errorMessage = error?.message || 'Could not publish this part';
					draft.parts = parts;
					draft.status = 'failed';
					draft.errorMessage = `Story ${part.index + 1} of ${parts.length}: ${part.errorMessage}`;
					await this.draftRepo.save(draft);
					this.logger.warn(
						`story publish stopped at part ${part.index + 1}/${parts.length} of draft ${
							draft.id
						}: ${part.errorMessage}`,
					);
					return this.serialize(draft);
				}
				draft.parts = parts;
				draft = await this.draftRepo.save(draft);
			}

			draft.status = 'published';
			draft.publishedAt = new Date();
			draft = await this.draftRepo.save(draft);
			return this.serialize(draft);
		} finally {
			this.publishing.delete(draft.id);
		}
	}

	async remove(user: User, draftId: string) {
		const draft = await this.requireDraft(user, draftId);
		await this.removeFiles(draft).catch(() => undefined);
		await this.draftRepo.delete(draft.id);
		return { ok: true };
	}

	private async removeFiles(draft: WhatsAppStoryDraft) {
		for (const part of draft.parts || []) {
			const absolutePath = resolveStoryPathInsideRoot(mediaRoot(), part.storagePath);
			if (absolutePath) await fs.rm(absolutePath, { force: true }).catch(() => undefined);
		}
		const folder = resolveStoryPathInsideRoot(
			mediaRoot(),
			path.posix.dirname(storyPartRelativePath(draft.userId, draft.id, 0)),
		);
		if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
	}
}
