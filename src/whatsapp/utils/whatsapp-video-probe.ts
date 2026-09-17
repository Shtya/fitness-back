import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { resolveFfmpeg, runFfmpeg } from './whatsapp-voice-ogg';

/**
 * Reading a video's shape, and taking a still out of it.
 *
 * WhatsApp needs duration, pixel size and a cover frame *inside* the message. Baileys
 * fills none of the three for video: it computes duration for audio only
 * (`requiresDurationComputation` is gated on `mediaType === 'audio'`), it reports
 * dimensions only for images, and its video thumbnail is a 32x32 frame produced by a
 * bare `ffmpeg` on PATH whose failure is swallowed at debug level. A status video
 * sent that way carries no length at all, which is what leaves the viewer's phone on
 * "Waiting for this status update". So we measure the file ourselves.
 */

export type VideoMeta = {
	seconds: number;
	width: number;
	height: number;
};

/**
 * Pulls duration and pixel size out of what `ffmpeg -i` prints.
 *
 * A rotated recording (every phone-held-upright video) stores landscape pixels plus
 * a rotation matrix, so the numbers on the stream line are the wrong way round for
 * display. Swapping on a quarter turn is what makes a portrait clip report portrait.
 */
export function parseVideoMetaFromFfmpegOutput(output: string): VideoMeta {
	const text = String(output || '');

	let seconds = 0;
	const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
	if (duration) {
		const value =
			Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
		if (Number.isFinite(value)) seconds = value;
	}

	let width = 0;
	let height = 0;
	// Anchored on the Video stream line so the audio line and the codec tag
	// (`0x31637661`) cannot be mistaken for a resolution.
	const videoLine = text.match(/Stream #\d+:\d+.*?: Video:.*/i)?.[0] || '';
	const size = videoLine.match(/(?<![\dx])(\d{2,5})x(\d{2,5})(?![\dx])/);
	if (size) {
		width = Number(size[1]);
		height = Number(size[2]);
	}

	const rotation = text.match(/rotation of (-?\d+(?:\.\d+)?) degrees/i);
	const quarterTurned = rotation
		? Math.abs(Math.round(Number(rotation[1])) % 180) === 90
		: false;
	if (quarterTurned) [width, height] = [height, width];

	return { seconds, width, height };
}

/** Runs `ffmpeg -i` purely to read metadata. Never throws; unknowns come back as 0. */
export function probeVideoMeta(filePath: string): Promise<VideoMeta> {
	return new Promise((resolve) => {
		const child = spawn(resolveFfmpeg(), ['-hide_banner', '-i', filePath], {
			windowsHide: true,
		});
		let output = '';
		const timer = setTimeout(() => {
			child.kill();
			resolve({ seconds: 0, width: 0, height: 0 });
		}, 15_000);
		// ffmpeg writes the stream summary to stderr, and exits non-zero without an output.
		child.stderr?.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.once('error', () => {
			clearTimeout(timer);
			resolve({ seconds: 0, width: 0, height: 0 });
		});
		child.once('close', () => {
			clearTimeout(timer);
			resolve(parseVideoMetaFromFfmpegOutput(output));
		});
	});
}

/**
 * FFmpeg arguments for a single cover frame.
 *
 * The frame is boxed into 320px because it travels inside the message itself rather
 * than as an upload, and `force_original_aspect_ratio=decrease` shrinks large videos
 * without blowing up small ones.
 */
export function buildVideoThumbnailFfmpegArgs(
	inputPath: string,
	outputPath: string,
	atSeconds = 0,
): string[] {
	return [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-ss',
		String(Math.max(0, Number(atSeconds) || 0)),
		'-i',
		inputPath,
		'-frames:v',
		'1',
		'-vf',
		'scale=w=320:h=320:force_original_aspect_ratio=decrease',
		'-f',
		'mjpeg',
		'-q:v',
		'6',
		outputPath,
	];
}

/**
 * The cover frame for a video, or `undefined` when one cannot be produced.
 *
 * A missing thumbnail degrades the preview; a thrown error would lose the whole
 * status. So this stays quiet and lets the caller send without one.
 */
export async function renderVideoThumbnail(
	filePath: string,
	atSeconds = 0,
): Promise<Buffer | undefined> {
	const target = path.join(os.tmpdir(), `wa-thumb-${randomUUID()}.jpg`);
	try {
		await runFfmpeg(buildVideoThumbnailFfmpegArgs(filePath, target, atSeconds), 20_000);
		const thumbnail = await fs.readFile(target);
		return thumbnail.length ? thumbnail : undefined;
	} catch {
		return undefined;
	} finally {
		await fs.rm(target, { force: true }).catch(() => undefined);
	}
}
