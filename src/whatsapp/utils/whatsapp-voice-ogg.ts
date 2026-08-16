import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

function isOggBuffer(buffer: Buffer): boolean {
	return Boolean(buffer?.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS');
}

export function resolveFfmpeg(): string {
	const fromEnv = process.env.FFMPEG_PATH?.trim();
	if (fromEnv) return fromEnv;
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require('ffmpeg-static') || 'ffmpeg';
	} catch {
		return 'ffmpeg';
	}
}

export function runFfmpeg(args: string[], timeoutMs = 30_000): Promise<void> {
	return new Promise((resolve, reject) => {
		const processHandle = spawn(resolveFfmpeg(), args, { windowsHide: true });
		let stderr = '';
		const timer = setTimeout(() => {
			processHandle.kill();
			reject(new Error('FFmpeg timed out'));
		}, timeoutMs);
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
}

export function probeAudioSeconds(filePath: string): Promise<number> {
	return new Promise((resolve) => {
		const processHandle = spawn(resolveFfmpeg(), ['-i', filePath], { windowsHide: true });
		let stderr = '';
		const timer = setTimeout(() => {
			processHandle.kill();
			resolve(0);
		}, 12_000);
		processHandle.stderr?.on('data', (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const finish = () => {
			clearTimeout(timer);
			const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
			if (!match) {
				resolve(0);
				return;
			}
			const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
			resolve(Number.isFinite(seconds) ? seconds : 0);
		};
		processHandle.once('error', () => {
			clearTimeout(timer);
			resolve(0);
		});
		processHandle.once('close', finish);
	});
}

export function guessVoiceSeconds(filePath: string, fileName?: string | null): number | undefined {
	const source = `${fileName || ''} ${path.basename(filePath || '')}`;
	const match = source.match(/voice-(\d+)s/i);
	const seconds = match ? Number(match[1]) : NaN;
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 299) : undefined;
}

/**
 * WhatsApp PTT is OGG/Opus. Chrome records WebM/Opus and sending that container
 * can ACK locally while the phone never shows the voice note.
 */
export async function ensureWhatsAppVoiceOgg(
	filePath: string,
	options: { mimeType?: string | null; fileName?: string | null } = {},
): Promise<{
	filePath: string;
	mimeType: string;
	fileName: string;
	cleanup?: () => Promise<void>;
}> {
	const originalName = options.fileName || path.basename(filePath);
	const buffer = await fs.readFile(filePath);
	if (!buffer.length) {
		throw new Error('Voice file is empty');
	}
	if (isOggBuffer(buffer)) {
		return {
			filePath,
			mimeType: 'audio/ogg; codecs=opus',
			fileName: originalName.replace(/\.[^.]+$/, '') + '.ogg',
		};
	}

	const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const outputPath = path.join(os.tmpdir(), `wa-voice-${stamp}.ogg`);
	await runFfmpeg(
		[
			'-y',
			'-i',
			filePath,
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
		30_000,
	);
	const converted = await fs.readFile(outputPath);
	if (!converted.length || !isOggBuffer(converted)) {
		await fs.rm(outputPath, { force: true }).catch(() => undefined);
		throw new Error('Converted voice file is not valid OGG/Opus');
	}
	return {
		filePath: outputPath,
		mimeType: 'audio/ogg; codecs=opus',
		fileName: `${path.parse(originalName).name || 'voice'}.ogg`,
		cleanup: async () => {
			await fs.rm(outputPath, { force: true }).catch(() => undefined);
		},
	};
}
