import * as path from 'path';
import {
	STORY_MAX_SECONDS,
	buildStorySegmentFfmpegArgs,
	describeStoryRejection,
	planStorySegments,
	resolveStoryPathInsideRoot,
	storyPartRelativePath,
} from './whatsapp-story-video';

describe('planStorySegments', () => {
	it('leaves a short video as a single story', () => {
		expect(planStorySegments(12)).toEqual([
			{ index: 0, startSeconds: 0, durationSeconds: 12 },
		]);
		expect(planStorySegments(STORY_MAX_SECONDS)).toHaveLength(1);
	});

	it('covers the whole video with no gap and no overlap', () => {
		const segments = planStorySegments(70);
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
		const segments = planStorySegments(60.4);
		expect(segments).toHaveLength(2);
		expect(segments[1]).toEqual({ index: 1, startSeconds: 30, durationSeconds: 30.4 });
		const covered = segments.reduce((sum, part) => sum + part.durationSeconds, 0);
		expect(covered).toBeCloseTo(60.4, 3);
	});

	it('keeps a tail that is long enough to stand alone', () => {
		const segments = planStorySegments(64);
		expect(segments).toHaveLength(3);
		expect(segments[2].durationSeconds).toBe(4);
	});

	it('numbers the parts in playback order from zero', () => {
		expect(planStorySegments(95).map(part => part.index)).toEqual([0, 1, 2, 3]);
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
