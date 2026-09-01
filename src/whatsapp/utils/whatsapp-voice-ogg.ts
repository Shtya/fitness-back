import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

function isOggBuffer(buffer: Buffer): boolean {
	return Boolean(buffer?.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS');
}

/** Baileys default for PTT; keep the space after the semicolon to match their encoder. */
export const WHATSAPP_VOICE_MIME = 'audio/ogg; codecs=opus';

/**
 * A raw space is not legal in a data URL media type. wa-js validates with
 * `valid-data-url`, whose parameter group rejects `; codecs=opus`, so passing
 * `WHATSAPP_VOICE_MIME` straight into a data URL fails with `invalid_data_url`
 * and the base64 send fallback can never deliver.
 */
export function dataUrlMime(
	mimeType?: string | null,
	fallback = 'application/octet-stream',
): string {
	return String(mimeType || '').replace(/\s+/g, '') || fallback;
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

/** WhatsApp PTT UI expects 64 samples in the 0–100 range. */
export const VOICE_WAVEFORM_SAMPLES = 64;

/**
 * Deterministic fake bars when decode fails — still better than WhatsApp's flat line.
 */
export function fallbackVoiceWaveform(
	seed: Buffer | string,
	samples = VOICE_WAVEFORM_SAMPLES,
): Uint8Array {
	const source = Buffer.isBuffer(seed) ? seed : Buffer.from(String(seed || 'voice'));
	const out = new Uint8Array(samples);
	let state = 0x811c9dc5;
	for (let i = 0; i < Math.min(source.length, 256); i += 1) {
		state ^= source[i];
		state = Math.imul(state, 0x01000193);
	}
	for (let i = 0; i < samples; i += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		const envelope = Math.sin((Math.PI * i) / Math.max(samples - 1, 1));
		const raw = ((state >>> 0) % 70) + 20;
		out[i] = Math.max(8, Math.min(100, Math.round(raw * (0.35 + 0.65 * envelope))));
	}
	return out;
}

function waveformFromPcmS16le(pcm: Buffer, samples = VOICE_WAVEFORM_SAMPLES): Uint8Array | null {
	if (!pcm?.length || pcm.length < 4) return null;
	const sampleCount = Math.floor(pcm.length / 2);
	if (sampleCount < samples) return null;
	const blockSize = Math.floor(sampleCount / samples);
	if (blockSize < 1) return null;
	const peaks: number[] = [];
	for (let i = 0; i < samples; i += 1) {
		const start = i * blockSize * 2;
		let sum = 0;
		for (let j = 0; j < blockSize; j += 1) {
			const offset = start + j * 2;
			if (offset + 1 >= pcm.length) break;
			sum += Math.abs(pcm.readInt16LE(offset));
		}
		peaks.push(sum / blockSize);
	}
	const max = Math.max(...peaks, 1);
	return new Uint8Array(peaks.map((value) => Math.max(1, Math.min(100, Math.round((value / max) * 100)))));
}

function decodeAudioToPcmS16le(filePath: string): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const processHandle = spawn(
			resolveFfmpeg(),
			['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
			{ windowsHide: true },
		);
		const chunks: Buffer[] = [];
		let stderr = '';
		const timer = setTimeout(() => {
			processHandle.kill();
			reject(new Error('Waveform decode timed out'));
		}, 20_000);
		processHandle.stdout?.on('data', (chunk: Buffer) => {
			chunks.push(chunk);
		});
		processHandle.stderr?.on('data', (chunk: Buffer) => {
			stderr = `${stderr}${chunk.toString()}`.slice(-1500);
		});
		processHandle.once('error', (error: Error) => {
			clearTimeout(timer);
			reject(error);
		});
		processHandle.once('close', (code: number) => {
			clearTimeout(timer);
			const pcm = Buffer.concat(chunks);
			if (code === 0 && pcm.length) {
				resolve(pcm);
				return;
			}
			reject(new Error(`Waveform decode failed (code ${code}): ${stderr}`));
		});
	});
}

/**
 * Build the waveform WhatsApp mobile shows for PTT notes.
 * Baileys only auto-generates this when optional `audio-decode` is installed —
 * we compute it with ffmpeg so site-sent notes match mobile bars.
 */
export async function buildVoiceWaveform(
	filePath: string,
	samples = VOICE_WAVEFORM_SAMPLES,
): Promise<Uint8Array> {
	try {
		const pcm = await decodeAudioToPcmS16le(filePath);
		const fromPcm = waveformFromPcmS16le(pcm, samples);
		if (fromPcm) return fromPcm;
	} catch {
		/* fall through */
	}
	try {
		const buffer = await fs.readFile(filePath);
		return fallbackVoiceWaveform(buffer, samples);
	} catch {
		return fallbackVoiceWaveform(path.basename(filePath || 'voice'), samples);
	}
}

export async function resolveVoiceSeconds(
	filePath: string,
	fileName?: string | null,
): Promise<number | undefined> {
	const fromName = guessVoiceSeconds(filePath, fileName);
	if (fromName) return fromName;
	const probed = await probeAudioSeconds(filePath);
	if (probed > 0) return Math.min(299, Math.max(1, Math.round(probed)));
	return undefined;
}

/**
 * WhatsApp PTT is OGG/Opus mono (16 kHz). Chrome records WebM/Opus and even
 * browser OGG can ACK locally while the recipient phone shows "audio no longer available".
 * Always re-encode through FFmpeg so mobile clients can decrypt and play the note.
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
			'16000',
			'-c:a',
			'libopus',
			'-b:a',
			'24k',
			'-application',
			'voip',
			'-f',
			'ogg',
			outputPath,
		],
		45_000,
	);
	const converted = await fs.readFile(outputPath);
	if (!converted.length || !isOggBuffer(converted)) {
		await fs.rm(outputPath, { force: true }).catch(() => undefined);
		throw new Error('Converted voice file is not valid OGG/Opus');
	}
	const probedSeconds = await probeAudioSeconds(outputPath);
	if (probedSeconds <= 0) {
		await fs.rm(outputPath, { force: true }).catch(() => undefined);
		throw new Error('Converted voice file has no playable audio duration');
	}
	return {
		filePath: outputPath,
		mimeType: WHATSAPP_VOICE_MIME,
		fileName: `${path.parse(originalName).name || 'voice'}.ogg`,
		cleanup: async () => {
			await fs.rm(outputPath, { force: true }).catch(() => undefined);
		},
	};
}

/**
 * Install a converted OGG next to (or over) the uploaded source path.
 * Never delete the destination when it is the same file we just wrote — that
 * was causing ENOENT when re-encoding an already-.ogg upload/share copy.
 */
export async function commitConvertedVoiceOgg(
	convertedTempPath: string,
	originalAbsolutePath: string,
): Promise<{ sendPath: string; fileName: string }> {
	const original = path.resolve(originalAbsolutePath);
	const oggPath = path.resolve(`${original.replace(/\.[^.]+$/i, '')}.ogg`);
	await fs.copyFile(convertedTempPath, oggPath);
	if (oggPath !== original) {
		await fs.rm(original, { force: true }).catch(() => undefined);
	}
	return { sendPath: oggPath, fileName: path.basename(oggPath) };
}

export function looksLikeOutgoingVoiceUpload(
	fileName?: string | null,
	mimeType?: string | null,
): boolean {
	const name = String(fileName || '').toLowerCase();
	if (/voice-\d+s/i.test(name)) return true;
	if (/^voice\.(ogg|opus|webm|mp3|m4a)$/i.test(name)) return true;
	const mime = String(mimeType || '')
		.toLowerCase()
		.replace(/\s+/g, '');
	return (
		mime.startsWith('audio/webm') ||
		mime.startsWith('audio/ogg') ||
		mime === 'audio/opus' ||
		mime.startsWith('audio/mpeg') ||
		mime.startsWith('audio/mp4')
	);
}

export async function isValidWhatsAppVoiceOggFile(filePath: string): Promise<boolean> {
	try {
		const buffer = await fs.readFile(filePath);
		if (!buffer?.length || buffer.subarray(0, 4).toString('ascii') !== 'OggS') {
			return false;
		}
		const seconds = await probeAudioSeconds(filePath);
		return seconds > 0;
	} catch {
		return false;
	}
}
