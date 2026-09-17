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
 * Not a platform constant — WhatsApp's own limit has moved over time and differs
 * between clients, so the length is a choice the caller makes and this is only the
 * starting point.
 */
export const STORY_DEFAULT_PART_SECONDS = 90;

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
 * FFmpeg arguments for cutting one clip out of a video.
 *
 * The cut re-encodes rather than copying streams. Copying is only frame-accurate on
 * a keyframe, so on an arbitrary 30-second boundary it produces a clip that opens on
 * a frozen or missing frame — the one thing the sequence must not do. `-crf 18`
 * keeps the result visually indistinguishable at the original resolution and frame
 * rate, and the audio is re-encoded to the AAC that WhatsApp accepts.
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
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		'-crf',
		'18',
		'-pix_fmt',
		'yuv420p',
		'-c:a',
		'aac',
		'-b:a',
		'128k',
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
