import * as path from 'path';
import {
	MAX_SOCIAL_VIDEO_BYTES,
	buildSocialDownloadArgs,
	describeSocialDownloadFailure,
	extractSocialVideoUrls,
	normalizeSocialVideoUrl,
	resolveSocialPathInsideRoot,
	socialDownloadRelativePath,
	socialDownloadTitle,
	socialVideoPlatform,
} from './whatsapp-social-download';

describe('socialVideoPlatform', () => {
	it('recognises the three supported platforms', () => {
		expect(socialVideoPlatform('https://www.tiktok.com/@user/video/7123')).toBe('tiktok');
		expect(socialVideoPlatform('https://vt.tiktok.com/ZSabc/')).toBe('tiktok');
		expect(socialVideoPlatform('https://www.instagram.com/reel/Abc/')).toBe('instagram');
		expect(socialVideoPlatform('https://instagr.am/p/Abc/')).toBe('instagram');
		expect(socialVideoPlatform('https://www.facebook.com/share/v/1H5BjZ8pa9/')).toBe('facebook');
		expect(socialVideoPlatform('https://fb.watch/1H5BjZ8pa9/')).toBe('facebook');
		expect(socialVideoPlatform('https://m.facebook.com/watch/?v=1')).toBe('facebook');
	});

	it('rejects lookalike hosts rather than substring-matching them', () => {
		expect(socialVideoPlatform('https://evil-tiktok.com/video/1')).toBeNull();
		expect(socialVideoPlatform('https://tiktok.com.attacker.net/x')).toBeNull();
		expect(socialVideoPlatform('https://notinstagram.com/reel/1')).toBeNull();
	});

	it('rejects non-http schemes and junk', () => {
		expect(socialVideoPlatform('file:///etc/passwd')).toBeNull();
		expect(socialVideoPlatform('javascript:alert(1)')).toBeNull();
		expect(socialVideoPlatform('ftp://tiktok.com/a')).toBeNull();
		expect(socialVideoPlatform('')).toBeNull();
		expect(socialVideoPlatform(null)).toBeNull();
		expect(socialVideoPlatform('not a url')).toBeNull();
	});

	it('rejects other video sites that are out of scope', () => {
		expect(socialVideoPlatform('https://www.youtube.com/watch?v=abc')).toBeNull();
		expect(socialVideoPlatform('https://example.com/clip.mp4')).toBeNull();
	});
});

describe('normalizeSocialVideoUrl', () => {
	it('drops share and tracking parameters so one post maps to one row', () => {
		const a = normalizeSocialVideoUrl(
			'https://www.facebook.com/share/v/1H5BjZ8pa9/?mibextid=wwXIfr&utm_source=x',
		);
		const b = normalizeSocialVideoUrl('https://www.facebook.com/share/v/1H5BjZ8pa9/');
		expect(a).toBe(b);
	});

	it('keeps meaningful parameters', () => {
		expect(normalizeSocialVideoUrl('https://m.facebook.com/watch/?v=999')).toContain('v=999');
	});

	it('strips the fragment', () => {
		expect(normalizeSocialVideoUrl('https://fb.watch/abc/#comments')).toBe('https://fb.watch/abc/');
	});

	it('returns null for unsupported urls', () => {
		expect(normalizeSocialVideoUrl('https://example.com/a')).toBeNull();
	});
});

describe('extractSocialVideoUrls', () => {
	it('finds links written with and without a scheme', () => {
		expect(extractSocialVideoUrls('watch www.facebook.com/share/v/1H5BjZ8pa9/ now')).toEqual([
			'https://www.facebook.com/share/v/1H5BjZ8pa9/',
		]);
		expect(extractSocialVideoUrls('https://vt.tiktok.com/ZSabc/')).toEqual([
			'https://vt.tiktok.com/ZSabc/',
		]);
	});

	it('finds schemeless bare-host links, matching what the UI offers to download', () => {
		// The UI's own detector accepts this form; if this did not, the download button
		// would appear and then fail server-side validation.
		expect(extractSocialVideoUrls('tiktok.com/@a/video/1')).toEqual([
			'https://tiktok.com/@a/video/1',
		]);
		expect(extractSocialVideoUrls('fb.watch/abc/')).toEqual(['https://fb.watch/abc/']);
		expect(extractSocialVideoUrls('instagram.com/reel/Abc/')).toEqual([
			'https://instagram.com/reel/Abc/',
		]);
	});

	it('strips trailing sentence punctuation', () => {
		expect(extractSocialVideoUrls('see https://fb.watch/abc/.')).toEqual(['https://fb.watch/abc/']);
	});

	it('ignores unsupported links and deduplicates share variants', () => {
		expect(extractSocialVideoUrls('https://example.com/a https://youtube.com/watch?v=1')).toEqual([]);
		expect(
			extractSocialVideoUrls(
				'https://fb.watch/abc/?utm_source=a and https://fb.watch/abc/?mibextid=b',
			),
		).toEqual(['https://fb.watch/abc/']);
	});

	it('returns nothing for empty input', () => {
		expect(extractSocialVideoUrls('')).toEqual([]);
		expect(extractSocialVideoUrls(null)).toEqual([]);
	});

	it('matches what a request must prove: a body url absent from the text is not listed', () => {
		const text = 'check https://www.tiktok.com/@a/video/1';
		expect(extractSocialVideoUrls(text)).not.toContain('https://fb.watch/attacker/');
	});
});

describe('buildSocialDownloadArgs', () => {
	it('passes the url as its own argv entry after a -- separator', () => {
		const args = buildSocialDownloadArgs('https://www.tiktok.com/@a/video/1', '/tmp/out.mp4');
		expect(args[args.length - 2]).toBe('--');
		expect(args[args.length - 1]).toBe('https://www.tiktok.com/@a/video/1');
	});

	it('never lets a hostile url become extra flags', () => {
		const hostile = 'https://www.tiktok.com/@a/video/1?x=--exec%20rm';
		const args = buildSocialDownloadArgs(hostile, '/tmp/out.mp4');
		// One entry, unsplit: with no shell involved this cannot become a second flag.
		expect(args.filter((arg) => arg === hostile)).toHaveLength(1);
		expect(args.indexOf(hostile)).toBe(args.length - 1);
	});

	it('points yt-dlp at the given ffmpeg, and omits the flag when there is none', () => {
		const withFfmpeg = buildSocialDownloadArgs(
			'https://fb.watch/a/',
			'/tmp/out.mp4',
			MAX_SOCIAL_VIDEO_BYTES,
			'/opt/ffmpeg',
		);
		expect(withFfmpeg[withFfmpeg.indexOf('--ffmpeg-location') + 1]).toBe('/opt/ffmpeg');
		expect(buildSocialDownloadArgs('https://fb.watch/a/', '/tmp/out.mp4')).not.toContain(
			'--ffmpeg-location',
		);
	});

	it('caps the download size and avoids playlists', () => {
		const args = buildSocialDownloadArgs('https://fb.watch/a/', '/tmp/out.mp4');
		expect(args).toContain('--no-playlist');
		expect(args).toContain('--max-filesize');
		expect(args[args.indexOf('--max-filesize') + 1]).toBe(String(MAX_SOCIAL_VIDEO_BYTES));
		expect(args[args.indexOf('--output') + 1]).toBe('/tmp/out.mp4');
	});
});

describe('describeSocialDownloadFailure', () => {
	it('explains a private post', () => {
		expect(describeSocialDownloadFailure('ERROR: login required to view', 1)).toMatch(/private/i);
	});

	it('explains a missing downloader and names the command that fixes it', () => {
		const message = describeSocialDownloadFailure('spawn ENOENT', null);
		expect(message).toMatch(/yt-dlp:install/);
		expect(message).toMatch(/YTDLP_PATH/);
	});

	it('explains an oversized video and an unavailable one', () => {
		expect(describeSocialDownloadFailure('File is larger than max-filesize', 1)).toMatch(/too large/i);
		expect(describeSocialDownloadFailure('ERROR: Video unavailable', 1)).toMatch(/no longer/i);
	});

	it('falls back to a generic message with the exit code', () => {
		expect(describeSocialDownloadFailure('something odd', 2)).toContain('exit 2');
		expect(describeSocialDownloadFailure('', null)).not.toContain('exit');
	});
});

describe('socialDownloadRelativePath', () => {
	it('namespaces per user and cannot climb out', () => {
		expect(socialDownloadRelativePath('user-1', 1000, 'abc')).toBe(
			'social/user-1/video-1000-abc.mp4',
		);
		expect(socialDownloadRelativePath('../../etc', 5, 'r')).toBe('social/etc/video-5-r.mp4');
	});
});

describe('socialDownloadTitle', () => {
	it('labels the platform and keeps a readable slug', () => {
		expect(socialDownloadTitle('tiktok', 'https://www.tiktok.com/@a/video/7123')).toBe(
			'TikTok video 7123',
		);
		expect(socialDownloadTitle('facebook', 'https://fb.watch/')).toBe('Facebook video');
	});
});

describe('resolveSocialPathInsideRoot', () => {
	const root = path.resolve('/srv/media');

	it('resolves a normal relative path', () => {
		expect(resolveSocialPathInsideRoot(root, 'social/user-1/video-1.mp4')).toBe(
			path.resolve(root, 'social/user-1/video-1.mp4'),
		);
	});

	it('refuses traversal and absolute paths', () => {
		expect(resolveSocialPathInsideRoot(root, '../../etc/passwd')).toBeNull();
		expect(resolveSocialPathInsideRoot(root, '/etc/passwd')).toBeNull();
		expect(resolveSocialPathInsideRoot(root, '')).toBeNull();
	});
});
