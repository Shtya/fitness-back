/**
 * Pure option handling for the "send video as voice message" mini editor.
 *
 * Everything here is deliberately side-effect free so the audio maths can be
 * unit tested without FFmpeg or a WhatsApp session. The service layer owns
 * process spawning and the ElevenLabs call.
 */

/** WhatsApp PTT itself caps at 299s; keep the editor inside the same budget. */
export const VOICE_EDIT_MAX_SECONDS = 299;
/** Below this an OGG/Opus note is not reliably playable on mobile. */
export const VOICE_EDIT_MIN_SECONDS = 1;
export const VOICE_EDIT_MIN_GAIN = 0.25;
export const VOICE_EDIT_MAX_GAIN = 3;

export type VoiceEditOptions = {
	/** Trim window in seconds, relative to the source. */
	startSeconds: number;
	/** `null` means "run to the end of the source". */
	endSeconds: number | null;
	/** Linear gain multiplier, 1 = unchanged. */
	gain: number;
	/** FFmpeg FFT denoiser. */
	noiseReduction: boolean;
	/** Speech band-pass + compression + loudness normalisation. */
	voiceEnhancement: boolean;
	/** ElevenLabs audio isolation — strips music/ambience, keeps the voice. */
	removeBackgroundMusic: boolean;
};

export const DEFAULT_VOICE_EDIT_OPTIONS: VoiceEditOptions = {
	startSeconds: 0,
	endSeconds: null,
	gain: 1,
	noiseReduction: false,
	voiceEnhancement: false,
	removeBackgroundMusic: false,
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function finiteOrNull(value: unknown): number | null {
	const num = Number(value);
	return Number.isFinite(num) ? num : null;
}

/**
 * Coerces untrusted request input into a usable edit window.
 *
 * `sourceSeconds` is optional because the caller may not have probed the file
 * yet; when it is known the window is clipped to it so a bad client cannot ask
 * FFmpeg for a range past the end of the media.
 */
export function normalizeVoiceEditOptions(
	input: Partial<Record<keyof VoiceEditOptions, unknown>> | null | undefined,
	sourceSeconds?: number | null,
): VoiceEditOptions {
	const raw = input || {};
	const duration = finiteOrNull(sourceSeconds);
	const limit =
		duration != null && duration > 0
			? Math.min(duration, VOICE_EDIT_MAX_SECONDS)
			: VOICE_EDIT_MAX_SECONDS;

	// Clamping the start to `limit - MIN` is what guarantees an open-ended window
	// still has something in it, so no further rescue is needed below.
	const start = clamp(
		finiteOrNull(raw.startSeconds) ?? 0,
		0,
		Math.max(0, limit - VOICE_EDIT_MIN_SECONDS),
	);
	let end = finiteOrNull(raw.endSeconds);
	if (end != null) {
		end = clamp(end, 0, limit);
		// A reversed or collapsed window is a client bug, not an intent to send
		// nothing. Fall back to "start → end of source".
		if (end - start < VOICE_EDIT_MIN_SECONDS) end = null;
	}

	// A voice note may not exceed the PTT ceiling even when the source does.
	if (end == null && duration != null && duration - start > VOICE_EDIT_MAX_SECONDS) {
		end = start + VOICE_EDIT_MAX_SECONDS;
	}
	if (end != null && end - start > VOICE_EDIT_MAX_SECONDS) {
		end = start + VOICE_EDIT_MAX_SECONDS;
	}

	return {
		startSeconds: Number(start.toFixed(3)),
		endSeconds: end == null ? null : Number(end.toFixed(3)),
		gain: Number(
			clamp(finiteOrNull(raw.gain) ?? 1, VOICE_EDIT_MIN_GAIN, VOICE_EDIT_MAX_GAIN).toFixed(3),
		),
		noiseReduction: Boolean(raw.noiseReduction),
		voiceEnhancement: Boolean(raw.voiceEnhancement),
		removeBackgroundMusic: Boolean(raw.removeBackgroundMusic),
	};
}

/** Seconds of audio the options will actually produce, when the source length is known. */
export function voiceEditOutputSeconds(
	options: VoiceEditOptions,
	sourceSeconds?: number | null,
): number | null {
	if (options.endSeconds != null) {
		return Number(Math.max(0, options.endSeconds - options.startSeconds).toFixed(3));
	}
	const duration = finiteOrNull(sourceSeconds);
	if (duration == null || duration <= 0) return null;
	return Number(
		Math.max(0, Math.min(duration, VOICE_EDIT_MAX_SECONDS) - options.startSeconds).toFixed(3),
	);
}

export function isDefaultVoiceEdit(options: VoiceEditOptions): boolean {
	return (
		options.startSeconds === 0 &&
		options.endSeconds == null &&
		options.gain === 1 &&
		!options.noiseReduction &&
		!options.voiceEnhancement &&
		!options.removeBackgroundMusic
	);
}

/**
 * `-af` chain for the requested cleanup, in signal order.
 *
 * Denoise runs before the band-pass so the FFT estimator still sees the full
 * spectrum, and loudness normalisation runs last so it measures the processed
 * signal rather than the raw one. Isolation is not represented here — that
 * happens out of process, before FFmpeg sees the file.
 */
export function buildVoiceEditFilters(options: VoiceEditOptions): string[] {
	const filters: string[] = [];

	if (options.noiseReduction) {
		// nf: noise floor in dB. -25 is audible cleanup without the "underwater"
		// artefacts that stronger settings give on phone recordings.
		filters.push('afftdn=nf=-25');
	}

	if (options.voiceEnhancement) {
		// Speech band, then gentle compression to even out distance from the mic.
		filters.push('highpass=f=90');
		filters.push('lowpass=f=8000');
		filters.push('acompressor=threshold=-18dB:ratio=3:attack=15:release=250:makeup=2');
	}

	if (options.gain !== 1) {
		filters.push(`volume=${options.gain}`);
	}

	if (options.voiceEnhancement) {
		// Two-pass loudnorm needs a measurement pass; single-pass is enough to land
		// in WhatsApp's usual range and keeps the request fast.
		filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
	} else if (options.gain > 1) {
		// Raising gain without normalisation can clip; bound the peaks.
		filters.push('alimiter=limit=0.95');
	}

	return filters;
}

/**
 * Full FFmpeg argument list for one edit pass.
 *
 * Trimming uses input seeking (`-ss` before `-i`) so long videos do not decode
 * from the beginning, and `-vn` drops the video stream entirely.
 */
export function buildVoiceEditFfmpegArgs(
	inputPath: string,
	outputPath: string,
	options: VoiceEditOptions,
	target: 'ogg' | 'mp3' = 'ogg',
): string[] {
	const args = ['-y'];

	if (options.startSeconds > 0) args.push('-ss', String(options.startSeconds));
	args.push('-i', inputPath);
	if (options.endSeconds != null) {
		args.push('-t', String(Math.max(0.05, options.endSeconds - options.startSeconds)));
	}

	args.push('-vn', '-ac', '1');

	const filters = buildVoiceEditFilters(options);
	if (filters.length) args.push('-af', filters.join(','));

	if (target === 'mp3') {
		// Preview only: mp3 plays natively everywhere, including Safari, where
		// OGG/Opus support cannot be relied on.
		args.push('-ar', '24000', '-c:a', 'libmp3lame', '-q:a', '5', '-f', 'mp3');
	} else {
		args.push('-ar', '16000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', '-f', 'ogg');
	}

	args.push(outputPath);
	return args;
}
