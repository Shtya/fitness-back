import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import type { User } from '../../../entities/global.entity';
import { WhatsAppMessage, WhatsAppSocialDownload } from '../entities/whatsapp.entity';
import { WhatsAppSyncService } from './whatsapp-sync.service';
import { probeAudioSeconds, resolveFfmpeg } from '../utils/whatsapp-voice-ogg';
import { signMediaToken, signedSocialDownloadPath } from '../utils/whatsapp-media-signed-url';
import {
	MAX_SOCIAL_VIDEO_BYTES,
	SOCIAL_DOWNLOAD_TIMEOUT_MS,
	type SocialPlatform,
	buildSocialDownloadArgs,
	describeSocialDownloadFailure,
	extractSocialVideoUrls,
	isRetryableSocialDownloadFailure,
	normalizeSocialVideoUrl,
	resolveSocialPathInsideRoot,
	socialDownloadRelativePath,
	socialDownloadTitle,
	socialRetryExtractorArgs,
	socialVideoPlatform,
} from '../utils/whatsapp-social-download';

function mediaRoot() {
	return path.resolve(
		process.env.WHATSAPP_MEDIA_ROOT || path.join(process.cwd(), 'storage', 'whatsapp-media'),
	);
}

/**
 * Mirrors `resolveFfmpeg`: an explicit path wins, then the copy `npm run
 * yt-dlp:install` provisions under `backend/tools/`, then whatever is on PATH.
 */
function resolveYtDlp(): string {
	const fromEnv = process.env.YTDLP_PATH?.trim();
	if (fromEnv) return fromEnv;
	const bundled = path.join(
		process.cwd(),
		'tools',
		process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
	);
	if (existsSync(bundled)) return bundled;
	return 'yt-dlp';
}

/** How many downloads one user may have running at once. */
const MAX_CONCURRENT_PER_USER = 2;

/** Playback URL lifetime. Long enough to outlive a working session in one thread. */
const SOCIAL_URL_TTL_SECONDS = 6 * 60 * 60;

/**
 * Downloads the video behind a TikTok / Instagram / Facebook link that arrived in a
 * message, so it can be played in the thread instead of leaving the app.
 *
 * The work runs detached from the request: `start()` records a `pending` row and
 * returns immediately, because yt-dlp regularly needs longer than a browser is
 * willing to wait. The client polls `status()`. That keeps the result durable — a
 * reload or a second viewer sees the finished clip rather than re-downloading it.
 */
@Injectable()
export class WhatsAppSocialDownloadService {
	private readonly logger = new Logger(WhatsAppSocialDownloadService.name);
	/** Guards against a double-click spawning two yt-dlp processes for one row. */
	private readonly running = new Set<string>();

	constructor(
		@InjectRepository(WhatsAppSocialDownload)
		private readonly downloadRepo: Repository<WhatsAppSocialDownload>,
		@InjectRepository(WhatsAppMessage)
		private readonly messageRepo: Repository<WhatsAppMessage>,
		private readonly sync: WhatsAppSyncService,
	) {}

	/**
	 * Confirms the caller may see the message and that the URL is one we accept.
	 *
	 * The URL is not taken from the request body: it must actually appear in the
	 * stored message text, otherwise this endpoint would be an open proxy that
	 * downloads any attacker-chosen address on the server's behalf.
	 */
	private async resolveTarget(
		user: User,
		conversationId: string,
		messageId: string,
		requestedUrl: string,
	) {
		await this.sync.assertConversationVisible(user, conversationId);
		const message = await this.messageRepo.findOne({
			where: { id: messageId, conversationId },
		});
		if (!message) throw new NotFoundException('WhatsApp message not found');

		const normalized = normalizeSocialVideoUrl(requestedUrl);
		const platform = socialVideoPlatform(requestedUrl);
		if (!normalized || !platform) {
			throw new BadRequestException('Not a supported TikTok, Instagram or Facebook video link');
		}
		if (!extractSocialVideoUrls(message.text).includes(normalized)) {
			throw new BadRequestException('That link is not part of this message');
		}
		return { message, normalized, platform };
	}

	private serialize(row: WhatsAppSocialDownload) {
		// Signed rather than plain: the player element loads this itself and cannot
		// attach the bearer token, so an unsigned path would simply come back 401.
		// Longer-lived than an attachment token: a thread stays open for hours and
		// nothing here re-signs mid-session, so a 15-minute URL would stop playing.
		const signed =
			row.status === 'ready' ? signMediaToken(row.id, row.userId, SOCIAL_URL_TTL_SECONDS) : null;
		return {
			id: row.id,
			messageId: row.messageId,
			sourceUrl: row.sourceUrl,
			platform: row.platform,
			status: row.status,
			title: row.title,
			mimeType: row.mimeType,
			durationSeconds: row.durationSeconds,
			fileSizeBytes: row.fileSizeBytes ? Number(row.fileSizeBytes) : null,
			errorMessage: row.errorMessage,
			url: signed ? signedSocialDownloadPath(row.id, signed.token) : null,
			urlExpiresAt: signed?.expiresAt || null,
		};
	}

	/** Current state for a message, so a reopened chat can render an existing clip. */
	async status(user: User, conversationId: string, messageId: string) {
		await this.sync.assertConversationVisible(user, conversationId);
		const rows = await this.downloadRepo.find({
			where: { messageId, userId: user.id },
			order: { created_at: 'DESC' },
		});
		return { items: rows.map((row) => this.serialize(row)) };
	}

	/**
	 * Every download this user has in a conversation, in one call.
	 *
	 * A thread can hold many social links, and the client needs all of their states
	 * the moment it opens — asking per message would mean one request per link and a
	 * downloaded video that only reappears after it is clicked again.
	 */
	async listForConversation(user: User, conversationId: string) {
		await this.sync.assertConversationVisible(user, conversationId);
		const rows = await this.downloadRepo
			.createQueryBuilder('download')
			.innerJoin(WhatsAppMessage, 'message', 'message.id = download.messageId')
			.where('message.conversationId = :conversationId', { conversationId })
			.andWhere('download.userId = :userId', { userId: user.id })
			.orderBy('download.created_at', 'DESC')
			.getMany();
		return { items: rows.map((row) => this.serialize(row)) };
	}

	/**
	 * Starts (or resumes) a download and returns its current state.
	 *
	 * A `ready` row is returned as-is: the same post is never fetched twice. A
	 * `failed` row is retried, which is what the retry button calls.
	 */
	async start(user: User, conversationId: string, messageId: string, requestedUrl: string) {
		const { normalized, platform } = await this.resolveTarget(
			user,
			conversationId,
			messageId,
			requestedUrl,
		);

		let row = await this.downloadRepo.findOne({
			where: { messageId, userId: user.id, sourceUrl: normalized },
		});

		if (row?.status === 'ready' && row.storagePath) {
			const absolute = resolveSocialPathInsideRoot(mediaRoot(), row.storagePath);
			// The row survives but the file may not (manual cleanup, lost volume).
			const stillThere = absolute
				? await fs
						.access(absolute)
						.then(() => true)
						.catch(() => false)
				: false;
			if (stillThere) return this.serialize(row);
		}

		if (row?.status === 'pending' && this.running.has(row.id)) return this.serialize(row);

		const inFlight = await this.downloadRepo.count({
			where: { userId: user.id, status: 'pending' },
		});
		if (!row && inFlight >= MAX_CONCURRENT_PER_USER) {
			throw new BadRequestException(
				'Another video is still downloading. Please wait for it to finish.',
			);
		}

		if (!row) {
			row = this.downloadRepo.create({
				messageId,
				userId: user.id,
				sourceUrl: normalized,
				platform,
			});
		}
		row.status = 'pending';
		row.errorMessage = null;
		row.completedAt = null;
		row.title = row.title || socialDownloadTitle(platform, normalized);
		row = await this.downloadRepo.save(row);

		// Deliberately not awaited: the HTTP response must not hold a yt-dlp run open.
		void this.run(row.id, user.id, normalized, platform);
		return this.serialize(row);
	}

	/** Runs yt-dlp and records the outcome. Never throws into the caller. */
	private async run(
		rowId: string,
		userId: string,
		url: string,
		platform: SocialPlatform,
	) {
		if (this.running.has(rowId)) return;
		this.running.add(rowId);
		const relativePath = socialDownloadRelativePath(userId);
		const absolutePath = resolveSocialPathInsideRoot(mediaRoot(), relativePath);
		try {
			if (!absolutePath) throw new Error('Invalid social download storage path');
			await fs.mkdir(path.dirname(absolutePath), { recursive: true });
			await this.attemptDownload(url, absolutePath, platform);

			const stat = await fs.stat(absolutePath);
			if (!stat.size) throw new Error('Downloader produced an empty file');
			if (stat.size > MAX_SOCIAL_VIDEO_BYTES) {
				throw new Error('File is larger than max-filesize');
			}
			// Reuses the FFmpeg duration probe already used for voice notes.
			const duration = await probeAudioSeconds(absolutePath).catch(() => 0);

			await this.downloadRepo.update(rowId, {
				status: 'ready',
				storagePath: relativePath,
				mimeType: 'video/mp4',
				fileSizeBytes: String(stat.size),
				durationSeconds: duration ? Math.round(duration) : null,
				errorMessage: null,
				completedAt: new Date(),
			});
		} catch (error: any) {
			// A partial file is useless and would be served as a broken video.
			if (absolutePath) await fs.rm(absolutePath, { force: true }).catch(() => undefined);
			const message = describeSocialDownloadFailure(
				error?.stderr || error?.message || '',
				typeof error?.exitCode === 'number' ? error.exitCode : null,
			);
			// The downloader's own output is the only useful part of this failure; without
			// it the log says "yt-dlp failed" and nobody can tell why.
			this.logger.warn(
				`social download failed row=${rowId} url=${url} exit=${
					error?.exitCode ?? 'n/a'
				}: ${error?.message || error}\n${String(error?.stderr || '').trim()}`,
			);
			await this.downloadRepo
				.update(rowId, { status: 'failed', errorMessage: message, completedAt: new Date() })
				.catch(() => undefined);
		} finally {
			this.running.delete(rowId);
		}
	}

	/**
	 * One download, with a single fallback attempt.
	 *
	 * The fallback exists because TikTok's web page answers a bot check often enough
	 * that a first failure says nothing about whether the video is reachable.
	 */
	private async attemptDownload(url: string, outputPath: string, platform: SocialPlatform) {
		try {
			await this.spawnYtDlp(url, outputPath);
		} catch (error: any) {
			const fallback = socialRetryExtractorArgs(
				platform,
				process.env.YTDLP_TIKTOK_API_HOSTNAME || undefined,
			);
			if (!fallback.length || !isRetryableSocialDownloadFailure(error?.stderr || '')) throw error;
			this.logger.warn(`social download retrying url=${url} with ${fallback.join(' ')}`);
			// A half-written file from the failed attempt would be appended to otherwise.
			await fs.rm(outputPath, { force: true }).catch(() => undefined);
			await this.spawnYtDlp(url, outputPath, fallback);
		}
	}

	private spawnYtDlp(url: string, outputPath: string, extraArgs: string[] = []) {
		return new Promise<void>((resolve, reject) => {
			// `--ffmpeg-location` must be a path that exists: yt-dlp rejects a bare
			// command name outright, even though `spawn` would have found it on PATH.
			const ffmpeg = resolveFfmpeg();
			const binary = resolveYtDlp();
			const child = spawn(
				binary,
				buildSocialDownloadArgs(
					url,
					outputPath,
					MAX_SOCIAL_VIDEO_BYTES,
					path.isAbsolute(ffmpeg) && existsSync(ffmpeg) ? ffmpeg : '',
					extraArgs,
				),
				{ windowsHide: true },
			);
			this.logger.debug(`social download spawn ${binary} url=${url}`);
			let stderr = '';
			let settled = false;
			const finish = (error?: any) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				if (error) reject(error);
				else resolve();
			};
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				finish(Object.assign(new Error('Download timed out'), { stderr }));
			}, SOCIAL_DOWNLOAD_TIMEOUT_MS);

			child.stderr?.on('data', (chunk) => {
				// Only the tail matters; yt-dlp can be very chatty on failure.
				stderr = `${stderr}${chunk}`.slice(-2000);
			});
			// stdout is piped whether or not we read it, so it has to be drained: a full
			// pipe buffer would block yt-dlp forever. Some extractor errors land here too.
			child.stdout?.on('data', (chunk) => {
				stderr = `${stderr}${chunk}`.slice(-2000);
			});
			child.on('error', (error) => finish(Object.assign(error, { stderr })));
			child.on('close', (code) => {
				if (code === 0) finish();
				else finish(Object.assign(new Error('yt-dlp failed'), { stderr, exitCode: code }));
			});
		});
	}

	/** Resolves a stored file for streaming, re-checking containment on every read. */
	async resolveFile(user: User, downloadId: string) {
		const row = await this.downloadRepo.findOne({
			where: { id: downloadId, userId: user.id },
		});
		if (!row || row.status !== 'ready' || !row.storagePath) {
			throw new NotFoundException('Downloaded video not found');
		}
		const absolutePath = resolveSocialPathInsideRoot(mediaRoot(), row.storagePath);
		if (!absolutePath) throw new NotFoundException('Downloaded video not found');
		const stat = await fs.stat(absolutePath).catch(() => null);
		if (!stat?.isFile()) throw new NotFoundException('Downloaded video is no longer stored');
		return {
			absolutePath,
			mimeType: row.mimeType || 'video/mp4',
			size: stat.size,
			fileName: `${(row.title || 'video').replace(/[^a-zA-Z0-9._-]/g, '_')}.mp4`,
		};
	}

	async remove(user: User, downloadId: string) {
		const row = await this.downloadRepo.findOne({
			where: { id: downloadId, userId: user.id },
		});
		if (!row) throw new NotFoundException('Downloaded video not found');
		if (row.storagePath) {
			const absolutePath = resolveSocialPathInsideRoot(mediaRoot(), row.storagePath);
			if (absolutePath) await fs.rm(absolutePath, { force: true }).catch(() => undefined);
		}
		await this.downloadRepo.delete(row.id);
		return { ok: true };
	}
}
