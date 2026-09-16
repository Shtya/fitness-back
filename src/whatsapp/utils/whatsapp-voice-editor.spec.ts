import {
	DEFAULT_VOICE_EDIT_OPTIONS,
	VOICE_EDIT_MAX_GAIN,
	VOICE_EDIT_MAX_SECONDS,
	VOICE_EDIT_MIN_GAIN,
	buildVoiceEditFfmpegArgs,
	buildVoiceEditFilters,
	isDefaultVoiceEdit,
	normalizeVoiceEditOptions,
	voiceEditOutputSeconds,
} from './whatsapp-voice-editor';

describe('normalizeVoiceEditOptions', () => {
	it('defaults to the whole source with no processing', () => {
		expect(normalizeVoiceEditOptions(null)).toEqual(DEFAULT_VOICE_EDIT_OPTIONS);
		expect(isDefaultVoiceEdit(normalizeVoiceEditOptions({}))).toBe(true);
	});

	it('keeps a valid trim window', () => {
		const options = normalizeVoiceEditOptions({ startSeconds: 15, endSeconds: 45 }, 120);
		expect(options.startSeconds).toBe(15);
		expect(options.endSeconds).toBe(45);
		expect(voiceEditOutputSeconds(options, 120)).toBe(30);
	});

	it('clips the window to the source duration', () => {
		const options = normalizeVoiceEditOptions({ startSeconds: 5, endSeconds: 999 }, 30);
		expect(options.endSeconds).toBe(30);
	});

	it('falls back to the end of the source when the window is reversed or collapsed', () => {
		expect(normalizeVoiceEditOptions({ startSeconds: 40, endSeconds: 10 }, 120).endSeconds).toBeNull();
		expect(normalizeVoiceEditOptions({ startSeconds: 10, endSeconds: 10.2 }, 120).endSeconds).toBeNull();
	});

	it('never exceeds the WhatsApp PTT ceiling', () => {
		const trimmed = normalizeVoiceEditOptions({ startSeconds: 0, endSeconds: 900 }, 1200);
		expect(trimmed.endSeconds).toBe(VOICE_EDIT_MAX_SECONDS);

		const openEnded = normalizeVoiceEditOptions({ startSeconds: 10 }, 1200);
		expect(openEnded.endSeconds).toBe(10 + VOICE_EDIT_MAX_SECONDS);
	});

	it('pulls the start back so an open-ended window always has audio in it', () => {
		const options = normalizeVoiceEditOptions({ startSeconds: 29.9 }, 30);
		expect(options.startSeconds).toBe(29);
		expect(voiceEditOutputSeconds(options, 30)).toBe(1);
	});

	it('clamps gain and ignores non-numeric input', () => {
		expect(normalizeVoiceEditOptions({ gain: 99 }).gain).toBe(VOICE_EDIT_MAX_GAIN);
		expect(normalizeVoiceEditOptions({ gain: 0 }).gain).toBe(VOICE_EDIT_MIN_GAIN);
		expect(normalizeVoiceEditOptions({ gain: 'loud' }).gain).toBe(1);
		expect(normalizeVoiceEditOptions({ startSeconds: NaN, endSeconds: 'x' }, 60)).toMatchObject({
			startSeconds: 0,
			endSeconds: null,
		});
	});
});

describe('buildVoiceEditFilters', () => {
	it('emits nothing when no processing is requested', () => {
		expect(buildVoiceEditFilters(normalizeVoiceEditOptions({ startSeconds: 3 }))).toEqual([]);
	});

	it('denoises before band-passing so the estimator sees the full spectrum', () => {
		const filters = buildVoiceEditFilters(
			normalizeVoiceEditOptions({ noiseReduction: true, voiceEnhancement: true }),
		);
		expect(filters.indexOf('afftdn=nf=-25')).toBeLessThan(filters.indexOf('highpass=f=90'));
	});

	it('normalises loudness last so it measures the processed signal', () => {
		const filters = buildVoiceEditFilters(
			normalizeVoiceEditOptions({ voiceEnhancement: true, gain: 1.5 }),
		);
		expect(filters[filters.length - 1]).toContain('loudnorm');
		expect(filters.some((f) => f === 'volume=1.5')).toBe(true);
	});

	it('limits peaks when gain is raised without normalisation', () => {
		const filters = buildVoiceEditFilters(normalizeVoiceEditOptions({ gain: 2 }));
		expect(filters).toEqual(['volume=2', 'alimiter=limit=0.95']);
	});

	it('does not limit when gain is reduced', () => {
		expect(buildVoiceEditFilters(normalizeVoiceEditOptions({ gain: 0.5 }))).toEqual(['volume=0.5']);
	});
});

describe('buildVoiceEditFfmpegArgs', () => {
	it('seeks on the input so long videos are not decoded from the start', () => {
		const args = buildVoiceEditFfmpegArgs(
			'/in.mp4',
			'/out.ogg',
			normalizeVoiceEditOptions({ startSeconds: 15, endSeconds: 45 }, 120),
		);
		expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
		expect(args[args.indexOf('-t') + 1]).toBe('30');
		expect(args).toContain('-vn');
		expect(args).toContain('libopus');
		expect(args[args.length - 1]).toBe('/out.ogg');
	});

	it('omits -ss and -t for an untrimmed source', () => {
		const args = buildVoiceEditFfmpegArgs('/in.mp4', '/out.ogg', normalizeVoiceEditOptions({}));
		expect(args).not.toContain('-ss');
		expect(args).not.toContain('-t');
	});

	it('encodes previews as mp3 for broad browser playback', () => {
		const args = buildVoiceEditFfmpegArgs(
			'/in.mp4',
			'/out.mp3',
			normalizeVoiceEditOptions({}),
			'mp3',
		);
		expect(args).toContain('libmp3lame');
		expect(args).not.toContain('libopus');
	});
});
