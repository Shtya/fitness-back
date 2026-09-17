import * as path from 'path';
import {
	STORY_DEFAULT_PART_SECONDS,
	STORY_MAX_LONG_EDGE,
	STORY_MAX_PART_SECONDS,
	STORY_MIN_PART_SECONDS,
	buildStorySegmentFfmpegArgs,
	describeStoryRejection,
	normalizeStoryPartSeconds,
	planStorySegments,
	resolveStoryPathInsideRoot,
	storyPartRelativePath,
} from './whatsapp-story-video';

describe('normalizeStoryPartSeconds', () => {
	it('falls back to the default for anything unusable', () => {
		expect(normalizeStoryPartSeconds(undefined)).toBe(STORY_DEFAULT_PART_SECONDS);
		expect(normalizeStoryPartSeconds(0)).toBe(STORY_DEFAULT_PART_SECONDS);
		expect(normalizeStoryPartSeconds('abc')).toBe(STORY_DEFAULT_PART_SECONDS);
	});

	it('clamps a choice into the usable range', () => {
		expect(normalizeStoryPartSeconds(30)).toBe(30);
		expect(normalizeStoryPartSeconds(1)).toBe(STORY_MIN_PART_SECONDS);
		expect(normalizeStoryPartSeconds(9999)).toBe(STORY_MAX_PART_SECONDS);
		expect(normalizeStoryPartSeconds(45.6)).toBe(46);
	});
});

describe('planStorySegments', () => {
	it('leaves a short video as a single story', () => {
		expect(planStorySegments(12)).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 12 },
		]);
		expect(planStorySegments(STORY_DEFAULT_PART_SECONDS)).toHaveLength(1);
	});

	it('defaults to the length a status player accepts', () => {
		expect(STORY_DEFAULT_PART_SECONDS).toBe(30);
		expect(planStorySegments(70)).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 30 },
			{ index: 1, startSeconds: 30, durationSeconds: 30 },
			{ index: 2, startSeconds: 60, durationSeconds: 10 },
		]);
	});

	it('honours a longer clip length when one is asked for', () => {
		expect(planStorySegments(200, 90)).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 90 },
			{ index: 1, startSeconds: 90, durationSeconds: 90 },
			{ index: 2, startSeconds: 180, durationSeconds: 20 },
		]);
	});

	it('covers the whole video with no gap and no overlap', () => {
		const segments = planStorySegments(70, 30);
		expect(segments).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 30 },
			{ index: 1, startSeconds: 30, durationSeconds: 30 },
			{ index: 2, startSeconds: 60, durationSeconds: 10 },
		]);
		// Each clip begins exactly where the previous one ended.
		for (let i = 1; i < segments.length; i += 1) {
			const previous = segments[i - 1];
			expect(segments[i].startSeconds).toBeCloseTo(
				previous.startSeconds + previous.durationSeconds,
				3,
			);
		}
		const covered = segments.reduce((sum, part) => sum + part.durationSeconds, 0);
		expect(covered).toBeCloseTo(70, 3);
	});

	it('folds a too-short tail into the clip before it', () => {
		const segments = planStorySegments(60.4, 30);
		expect(segments).toHaveLength(2);
		expect(segments[1]).toEqual({ index: 1, startSeconds: 30, durationSeconds: 30.4 });
		const covered = segments.reduce((sum, part) => sum + part.durationSeconds, 0);
		expect(covered).toBeCloseTo(60.4, 3);
	});

	it('keeps a tail that is long enough to stand alone', () => {
		const segments = planStorySegments(64, 30);
		expect(segments).toHaveLength(3);
		expect(segments[2].durationSeconds).toBe(4);
	});

	it('numbers the parts in playback order from zero', () => {
		expect(planStorySegments(95, 30).map(part => part.index)).toEqual([0, 1, 2, 3]);
	});

	it('honours a different platform limit', () => {
		expect(planStorySegments(100, 60)).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 60 },
			{ index: 1, startSeconds: 60, durationSeconds: 40 },
		]);
	});

	it('returns nothing for a duration it cannot use', () => {
		expect(planStorySegments(0)).toEqual([]);
		expect(planStorySegments(Number.NaN)).toEqual([]);
		expect(planStorySegments(-5)).toEqual([]);
	});
});

describe('buildStorySegmentFfmpegArgs', () => {
	it('seeks accurately and bounds the clip by duration, not by end time', () => {
		const args = buildStorySegmentFfmpegArgs('/in.mp4', '/out.mp4', {
			startSeconds: 30,
			durationSeconds: 12.5,
		});
		expect(args).toContain('-accurate_seek');
		// -ss must precede -i to seek by index instead of decoding from zero.
		expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
		expect(args[args.indexOf('-ss') + 1]).toBe('30');
		expect(args[args.indexOf('-t') + 1]).toBe('12.5');
		expect(args[args.length - 1]).toBe('/out.mp4');
	});

	it('re-encodes both tracks so a cut never opens on a frozen frame', () => {
		const args = buildStorySegmentFfmpegArgs('/in.mp4', '/out.mp4', {
			startSeconds: 0,
			durationSeconds: 30,
		});
		expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
		expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
		expect(args).not.toContain('copy');
	});

	it('produces a clip a status player can decode and stream', () => {
		const args = buildStorySegmentFfmpegArgs('/in.mp4', '/out.mp4', {
			startSeconds: 0,
			durationSeconds: 30,
		});
		expect(args[args.indexOf('-profile:v') + 1]).toBe('main');
		expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
		expect(args[args.indexOf('-ar') + 1]).toBe('44100');
		expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
		// Caps the long edge without enlarging a smaller video.
		expect(args[args.indexOf('-vf') + 1]).toContain(`min(${STORY_MAX_LONG_EDGE},iw)`);
		// A silent source must still cut, so the audio track is optional.
		expect(args).toContain('0:a:0?');
		// Data and subtitle tracks make a status unplayable.
		expect(args).toContain('-sn');
		expect(args).toContain('-dn');
	});
});

describe('storyPartRelativePath', () => {
	it('namespaces per user and draft, and numbers parts from one', () => {
		expect(storyPartRelativePath('user-1', 'draft-2', 0)).toBe(
			'story-drafts/user-1/draft-2/part-1.mp4',
		);
		expect(storyPartRelativePath('user-1', 'draft-2', 2)).toBe(
			'story-drafts/user-1/draft-2/part-3.mp4',
		);
	});

	it('cannot be steered out of its own folder', () => {
		expect(storyPartRelativePath('../etc', '../../root', 0)).toBe(
			'story-drafts/etc/root/part-1.mp4',
		);
	});
});

describe('resolveStoryPathInsideRoot', () => {
	it('resolves a normal relative path', () => {
		const root = path.resolve('/media');
		expect(resolveStoryPathInsideRoot(root, 'story-drafts/u/d/part-1.mp4')).toBe(
			path.join(root, 'story-drafts', 'u', 'd', 'part-1.mp4'),
		);
	});

	it('refuses traversal and absolute paths', () => {
		const root = path.resolve('/media');
		expect(resolveStoryPathInsideRoot(root, '../secrets.txt')).toBeNull();
		expect(resolveStoryPathInsideRoot(root, '/etc/passwd')).toBeNull();
		expect(resolveStoryPathInsideRoot(root, '')).toBeNull();
	});
});

describe('describeStoryRejection', () => {
	it('accepts a usable duration', () => {
		expect(describeStoryRejection(45)).toBeNull();
	});

	it('rejects an unreadable duration and an overly long video', () => {
		expect(describeStoryRejection(0)).toMatch(/could not be read/i);
		expect(describeStoryRejection(20 * 60)).toMatch(/15 minutes/);
	});
});
