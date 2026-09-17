import * as path from 'path';
import {
	BROWSER_USER_AGENT,
	MAX_SOCIAL_VIDEO_BYTES,
	TIKTOK_API_HOSTNAME,
	buildSocialDownloadArgs,
	describeSocialDownloadFailure,
	extractSocialVideoUrls,
	findSocialVideoUrlInText,
	isRetryableSocialDownloadFailure,
	lastSocialDownloadError,
	normalizeSocialVideoUrl,
	socialDownloadAttempts,
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

	it('repeats the downloader\'s own reason instead of only an exit code', () => {
		const message = describeSocialDownloadFailure(
			'[TikTok] Extracting URL\nERROR: [TikTok] 7123: Unable to extract webpage; please report this issue on https://github.com/yt-dlp',
			1,
		);
		expect(message).toContain('Unable to extract webpage');
		expect(message).not.toMatch(/report this issue/i);
		expect(message).not.toContain('exit 1');
	});

	it('falls back to a generic message with the exit code', () => {
		expect(describeSocialDownloadFailure('something odd', 2)).toContain('exit 2');
		expect(describeSocialDownloadFailure('', null)).not.toContain('exit');
	});
});

describe('socialDownloadAttempts', () => {
	it('starts with the default path so a working link is not slowed down', () => {
		expect(socialDownloadAttempts('tiktok')[0]).toEqual([]);
		expect(socialDownloadAttempts('facebook')[0]).toEqual([]);
	});

	it('escalates TikTok to a browser agent and then the mobile api host', () => {
		const attempts = socialDownloadAttempts('tiktok');
		expect(attempts).toHaveLength(3);
		expect(attempts[1]).toEqual(['--no-cache-dir', '--user-agent', BROWSER_USER_AGENT]);
		expect(attempts[2]).toEqual([
			'--no-cache-dir',
			'--extractor-args',
			`tiktok:api_hostname=${TIKTOK_API_HOSTNAME}`,
		]);
	});

	it('keeps the api-host rung off the platforms it does not apply to', () => {
		expect(socialDownloadAttempts('facebook')).toHaveLength(2);
		expect(socialDownloadAttempts('instagram')).toHaveLength(2);
		expect(socialDownloadAttempts('facebook').flat()).not.toContain('--extractor-args');
	});

	it('takes overrides for both tunables', () => {
		const attempts = socialDownloadAttempts('tiktok', {
			tiktokApiHostname: 'api99.example.com',
			userAgent: 'Custom/1.0',
		});
		expect(attempts[1]).toContain('Custom/1.0');
		expect(attempts[2]).toContain('tiktok:api_hostname=api99.example.com');
	});

	it('lands in the argument list before the url', () => {
		const args = buildSocialDownloadArgs(
			'https://vt.tiktok.com/a/',
			'/tmp/out.mp4',
			MAX_SOCIAL_VIDEO_BYTES,
			'',
			socialDownloadAttempts('tiktok')[2],
		);
		expect(args.indexOf('--extractor-args')).toBeLessThan(args.indexOf('--'));
		expect(args.indexOf('--no-cache-dir')).toBeLessThan(args.indexOf('--'));
	});
});

describe('findSocialVideoUrlInText', () => {
	it('downloads the link as written, while deduping on the stripped form', () => {
		const text = 'look https://vt.tiktok.com/ZSqbvxjPk/?_t=ZS-99n6&_r=1 nice';
		const found = findSocialVideoUrlInText(text, 'https://vt.tiktok.com/ZSqbvxjPk/');
		expect(found).toEqual({
			raw: 'https://vt.tiktok.com/ZSqbvxjPk/?_t=ZS-99n6&_r=1',
			normalized: 'https://vt.tiktok.com/ZSqbvxjPk/',
		});
	});

	it('still refuses a url the sender never posted', () => {
		expect(
			findSocialVideoUrlInText('https://vt.tiktok.com/a/', 'https://vt.tiktok.com/b/'),
		).toBeNull();
		expect(findSocialVideoUrlInText('no links here', 'https://vt.tiktok.com/a/')).toBeNull();
	});

	it('keeps the first occurrence of a link that appears twice', () => {
		const found = findSocialVideoUrlInText(
			'https://vt.tiktok.com/a/?_t=first https://vt.tiktok.com/a/?_t=second',
			'https://vt.tiktok.com/a/',
		);
		expect(found?.raw).toBe('https://vt.tiktok.com/a/?_t=first');
	});
});

describe('isRetryableSocialDownloadFailure', () => {
	it('retries the failures that pass on their own', () => {
		expect(
			isRetryableSocialDownloadFailure('ERROR: [TikTok] 7123: Unexpected response from webpage request'),
		).toBe(true);
		expect(isRetryableSocialDownloadFailure('ERROR: HTTP Error 503: Service Unavailable')).toBe(true);
	});

	it('does not retry a failure that will repeat', () => {
		expect(isRetryableSocialDownloadFailure('ERROR: login required')).toBe(false);
		expect(isRetryableSocialDownloadFailure('spawn ENOENT')).toBe(false);
		expect(isRetryableSocialDownloadFailure('File is larger than max-filesize')).toBe(false);
		expect(isRetryableSocialDownloadFailure('')).toBe(false);
	});
});

describe('lastSocialDownloadError', () => {
	it('takes the final ERROR line, without colour codes', () => {
		expect(
			lastSocialDownloadError('ERROR: first thing\n\u001b[0;31mERROR:\u001b[0m second thing'),
		).toBe('second thing');
	});

	it('ignores progress noise and truncates a very long reason', () => {
		expect(lastSocialDownloadError('[download] 12% of 3MiB')).toBe('');
		expect(lastSocialDownloadError(`ERROR: ${'x'.repeat(400)}`)).toHaveLength(160);
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
