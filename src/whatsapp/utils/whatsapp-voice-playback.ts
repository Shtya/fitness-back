import { promises as fs } from 'fs';
import * as path from 'path';
import { readFileHeader } from './whatsapp-media-decode';
import { runFfmpeg } from './whatsapp-voice-ogg';

/** Query value clients send when their `<audio>` cannot decode Ogg/Opus (iOS Safari). */
export const VOICE_PLAYBACK_FORMAT_M4A = 'm4a';

const PLAYBACK_SUFFIX = '.play.m4a';
const inFlight = new Map<string, Promise<string>>();

function isOggHeader(head: Buffer): boolean {
	return head.length >= 4 && head.subarray(0, 4).toString('ascii') === 'OggS';
}

function isWebmHeader(head: Buffer): boolean {
	return head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3;
}

/** Ogg/Opus and WebM/Opus need conversion; MP3/AAC/WAV already play everywhere. */
export async function needsM4aForPlayback(
	absolutePath: string,
	mimeType?: string | null,
): Promise<boolean> {
	const mime = String(mimeType || '').toLowerCase();
	if (mime.includes('ogg') || mime.includes('opus') || mime.includes('webm')) return true;
	if (mime.startsWith('audio/') && !mime.includes('octet-stream')) return false;
	try {
		const head = await readFileHeader(absolutePath, 4);
		return isOggHeader(head) || isWebmHeader(head);
	} catch {
		return false;
	}
}

async function isFreshCopy(sourcePath: string, outputPath: string): Promise<boolean> {
	try {
		const [source, output] = await Promise.all([fs.stat(sourcePath), fs.stat(outputPath)]);
		return output.size > 0 && output.mtimeMs >= source.mtimeMs;
	} catch {
		return false;
	}
}

async function transcodeToM4a(sourcePath: string, outputPath: string): Promise<string> {
	if (await isFreshCopy(sourcePath, outputPath)) return outputPath;
	const tempPath = `${outputPath}.${process.pid}-${Date.now()}.tmp`;
	try {
		await runFfmpeg(
			[
				'-y',
				'-i',
				sourcePath,
				'-vn',
				'-ac',
				'1',
				'-c:a',
				'aac',
				'-b:a',
				'64k',
				'-movflags',
				'+faststart',
				'-map_metadata',
				'-1',
				'-f',
				'mp4',
				tempPath,
			],
			45_000,
		);
		const stats = await fs.stat(tempPath);
		if (!stats.size) throw new Error('Converted voice file is empty');
		await fs.rename(tempPath, outputPath);
		return outputPath;
	} catch (error) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		throw error;
	}
}

/**
 * Returns an AAC/M4A copy of a voice note, built once and kept beside the original.
 * Concurrent requests for the same note share one ffmpeg run.
 */
export function ensureVoicePlaybackM4a(absolutePath: string): Promise<string> {
	const outputPath = `${absolutePath}${PLAYBACK_SUFFIX}`;
	const pending = inFlight.get(outputPath);
	if (pending) return pending;
	const job = transcodeToM4a(absolutePath, outputPath).finally(() => {
		inFlight.delete(outputPath);
	});
	inFlight.set(outputPath, job);
	return job;
}

export function playbackFileName(fileName?: string | null): string {
	const base = path.parse(String(fileName || 'voice')).name || 'voice';
	return `${base}.m4a`;
}
