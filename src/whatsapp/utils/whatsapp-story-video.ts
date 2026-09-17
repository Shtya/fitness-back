import * as path from 'path';

/**
 * Pure helpers for turning one video into a sequence of story clips.
 *
 * The planning is separated from FFmpeg so the part boundaries — the thing that
 * decides whether a viewer sees every frame exactly once — can be tested without
 * encoding anything.
 */

/**
 * How long each clip is by default.
 *
 * 30 seconds is what a WhatsApp client will actually play as a status — it is the
 * length the app trims to, and the length it slices a longer video into. A clip past
 * it uploads without complaint and then sits on "Waiting for this status update" on
 * the viewer's phone, so this is the only value known to be safe. Longer lengths are
 * still selectable for accounts whose client accepts them.
 */
export const STORY_DEFAULT_PART_SECONDS = 30;

/** Above this a clip is no longer known to play as a status. */
export const STORY_SAFE_PART_SECONDS = 30;

/** The range a caller may ask for. Outside this the result stops being a story. */
export const STORY_MIN_PART_SECONDS = 5;
export const STORY_MAX_PART_SECONDS = 180;

/** Clamps a requested clip length into the usable range. */
export function normalizeStoryPartSeconds(requested: unknown): number {
	const value = Number(requested);
	if (!Number.isFinite(value) || value <= 0) return STORY_DEFAULT_PART_SECONDS;
	return Math.min(STORY_MAX_PART_SECONDS, Math.max(STORY_MIN_PART_SECONDS, Math.round(value)));
}

/**
 * A tail shorter than this is folded into the previous clip instead of becoming its
 * own story. A one-second story is noise, and WhatsApp often drops it outright.
 */
export const STORY_MIN_TAIL_SECONDS = 1.5;

/** How long a video may be before we refuse to slice it at all. */
export const STORY_MAX_TOTAL_SECONDS = 15 * 60;

export type StorySegment = {
	index: number;
	startSeconds: number;
	durationSeconds: number;
};

function round(value: number, places = 3): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

/**
 * Splits a duration into consecutive story-length windows.
 *
 * Each window starts exactly where the previous one ended, so the clips together
 * reproduce the original with no gap and no repeated frame. The last window carries
 * the remainder rather than being padded, unless that remainder is too short to be
 * worth its own story, in which case the previous window absorbs it.
 */
export function planStorySegments(
	totalSeconds: number,
	maxSeconds = STORY_DEFAULT_PART_SECONDS,
	minTailSeconds = STORY_MIN_TAIL_SECONDS,
): StorySegment[] {
	const total = Number(totalSeconds);
	const limit = Math.max(1, Number(maxSeconds) || STORY_DEFAULT_PART_SECONDS);
	if (!Number.isFinite(total) || total <= 0) return [];
	if (total <= limit) {
		return [{ index: 0, startSeconds: 0, durationSeconds: round(total) }];
	}

	const segments: StorySegment[] = [];
	for (let start = 0; start < total; start += limit) {
		segments.push({
			index: segments.length,
			startSeconds: round(start),
			durationSeconds: round(Math.min(limit, total - start)),
		});
	}

	const last = segments[segments.length - 1];
	if (segments.length > 1 && last.durationSeconds < minTailSeconds) {
		segments.pop();
		const previous = segments[segments.length - 1];
		previous.durationSeconds = round(previous.durationSeconds + last.durationSeconds);
	}
	return segments;
}

/**
 * Never enlarges the picture: the long side is capped, the short side follows at an
 * even number of pixels. A status above this size is a slow download for the viewer
 * and, on some clients, one that never finishes.
 */
export const STORY_MAX_LONG_EDGE = 1280;

const STORY_SCALE_FILTER = [
	`scale=w='if(gte(iw,ih),min(${STORY_MAX_LONG_EDGE},iw),-2)'`,
	`h='if(gte(iw,ih),-2,min(${STORY_MAX_LONG_EDGE},ih))'`,
].join(':');

/**
 * FFmpeg arguments for cutting one clip out of a video.
 *
 * The cut re-encodes rather than copying streams. Copying is only frame-accurate on
 * a keyframe, so on an arbitrary boundary it produces a clip that opens on a frozen
 * or missing frame — the one thing the sequence must not do.
 *
 * Everything past the cut exists so the clip looks like one the WhatsApp app itself
 * produced: H.264 main profile at level 4.0 (what the status player is guaranteed to
 * decode, unlike the high profile libx264 picks by default), 8-bit 4:2:0, capped
 * frame rate and bitrate, a keyframe every second so the viewer can start
 * immediately, and 44.1 kHz stereo AAC. Extra data and subtitle tracks are dropped
 * because a status carrying them is refused outright.
 *
 * `-ss` before `-i` seeks by index and is fast; `-accurate_seek` keeps it exact.
 */
export function buildStorySegmentFfmpegArgs(
	inputPath: string,
	outputPath: string,
	segment: Pick<StorySegment, 'startSeconds' | 'durationSeconds'>,
): string[] {
	return [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-accurate_seek',
		'-ss',
		String(Math.max(0, Number(segment.startSeconds) || 0)),
		'-i',
		inputPath,
		'-t',
		String(Math.max(0.1, Number(segment.durationSeconds) || 0)),
		'-map',
		'0:v:0',
		// Optional: a silent clip is still a valid story.
		'-map',
		'0:a:0?',
		'-sn',
		'-dn',
		'-vf',
		STORY_SCALE_FILTER,
		'-c:v',
		'libx264',
		'-profile:v',
		'main',
		'-level:v',
		'4.0',
		'-preset',
		'veryfast',
		'-crf',
		'23',
		'-maxrate',
		'3M',
		'-bufsize',
		'6M',
		'-pix_fmt',
		'yuv420p',
		'-r',
		'30',
		'-g',
		'30',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		'-ar',
		'44100',
		'-ac',
		'2',
		'-avoid_negative_ts',
		'make_zero',
		// Story players stream from the start, so the index belongs at the front.
		'-movflags',
		'+faststart',
		outputPath,
	];
}

/** Storage-relative path for one prepared clip. Namespaced per user and per draft. */
export function storyPartRelativePath(userId: string, draftId: string, index: number): string {
	const safeUser = String(userId || '').replace(/[^a-z0-9-]/gi, '');
	const safeDraft = String(draftId || '').replace(/[^a-z0-9-]/gi, '');
	return `story-drafts/${safeUser}/${safeDraft}/part-${index + 1}.mp4`;
}

/** Guards a stored path against escaping the media root. */
export function resolveStoryPathInsideRoot(root: string, storagePath: string): string | null {
	const relative = String(storagePath || '').replace(/\\/g, '/');
	if (
		!relative ||
		relative.includes('..') ||
		relative.startsWith('/') ||
		path.isAbsolute(relative)
	) {
		return null;
	}
	const absoluteRoot = path.resolve(root);
	const resolved = path.resolve(absoluteRoot, relative);
	if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
		return null;
	}
	return resolved;
}

/** Why a video cannot become a story, or `null` when it can. */
export function describeStoryRejection(
	durationSeconds: number,
	maxTotalSeconds = STORY_MAX_TOTAL_SECONDS,
): string | null {
	const duration = Number(durationSeconds);
	if (!Number.isFinite(duration) || duration <= 0) {
		return 'The length of this video could not be read, so it cannot be split into stories.';
	}
	if (duration > maxTotalSeconds) {
		const minutes = Math.floor(maxTotalSeconds / 60);
		return `This video is longer than ${minutes} minutes, which is too long to publish as stories.`;
	}
	return null;
}
