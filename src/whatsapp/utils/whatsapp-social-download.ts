import * as path from 'path';

/**
 * Pure helpers for downloading a video from a social post URL.
 *
 * The URL is attacker-controlled (it arrives inside a WhatsApp message), so host
 * validation and argument construction live here, isolated from any process spawn
 * and unit-tested on their own.
 */

export type SocialPlatform = 'tiktok' | 'instagram' | 'facebook';

/** Host suffixes only — a suffix match on a label boundary, never a substring. */
const SOCIAL_VIDEO_HOSTS: { suffix: string; platform: SocialPlatform }[] = [
	{ suffix: 'tiktok.com', platform: 'tiktok' },
	{ suffix: 'instagram.com', platform: 'instagram' },
	{ suffix: 'instagr.am', platform: 'instagram' },
	{ suffix: 'facebook.com', platform: 'facebook' },
	{ suffix: 'fb.watch', platform: 'facebook' },
	{ suffix: 'fb.com', platform: 'facebook' },
];

export const MAX_SOCIAL_VIDEO_BYTES = 200 * 1024 * 1024;
/**
 * Generous on purpose: TikTok answers a JavaScript challenge before it hands over
 * any format list, which on its own has been measured at over 90 seconds.
 */
export const SOCIAL_DOWNLOAD_TIMEOUT_MS = 300_000;

/**
 * Validates the URL and returns its platform, or `null` if it is not a supported
 * social video link.
 *
 * Rejects everything except http/https so the URL can never become a `file://`
 * read or a shell-interpreted string.
 */
export function socialVideoPlatform(rawUrl: unknown): SocialPlatform | null {
	let parsed: URL;
	try {
		parsed = new URL(String(rawUrl || ''));
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
	const match = SOCIAL_VIDEO_HOSTS.find(
		(entry) => hostname === entry.suffix || hostname.endsWith(`.${entry.suffix}`),
	);
	return match ? match.platform : null;
}

/** Canonical form stored on the row, so the same post is not downloaded twice. */
export function normalizeSocialVideoUrl(rawUrl: unknown): string | null {
	if (!socialVideoPlatform(rawUrl)) return null;
	const parsed = new URL(String(rawUrl));
	// Tracking parameters differ per share but address the same video.
	for (const key of [...parsed.searchParams.keys()]) {
		if (/^(utm_|fbclid|mibextid|igshid|_r|_t|share_)/i.test(key)) parsed.searchParams.delete(key);
	}
	parsed.hash = '';
	return parsed.toString();
}

/**
 * Every supported video URL present in a message's text, normalized.
 *
 * The download endpoint uses this to prove the requested URL really came from the
 * message rather than trusting the request body — otherwise the endpoint would be an
 * open proxy that fetches any address chosen by the caller.
 */
export function extractSocialVideoUrls(text: unknown): string[] {
	return findSocialVideoUrlsInText(text).map((entry) => entry.normalized);
}

/**
 * Both forms of every supported link in a message: as written, and normalized.
 *
 * The two are not interchangeable. The normalized form is a dedup key, so it drops
 * the share parameters. The form as written is what should actually be fetched:
 * `?_r=1&_t=...` on a TikTok share link is part of how that page is served, and a
 * downloader handed the stripped URL is making a colder request than the user did.
 */
export function findSocialVideoUrlsInText(
	text: unknown,
): { raw: string; normalized: string }[] {
	const found = new Map<string, string>();
	// Mirrors the frontend's `MESSAGE_URL_PATTERN`, including the schemeless bare-host
	// form (`tiktok.com/@a/video/1`). If this were narrower, the UI would offer a
	// download the server then rejects as "not part of this message".
	const pattern =
		/(?:https?:\/\/|www\.)[^\s<>"']+|(?:(?:m\.|www\.)?(?:facebook|instagram|tiktok)\.com|fb\.watch|instagr\.am|fb\.com)\/[^\s<>"']+/gi;
	for (const match of String(text || '').match(pattern) || []) {
		const trimmed = match.replace(/[),.!?;:\]}]+$/, '');
		const raw = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
		const normalized = normalizeSocialVideoUrl(raw);
		// First occurrence wins: that is the one the sender actually pasted.
		if (normalized && !found.has(normalized)) found.set(normalized, raw);
	}
	return [...found.entries()].map(([normalized, raw]) => ({ raw, normalized }));
}

/**
 * The link in the message that the requested URL refers to, or `null`.
 *
 * Resolving through the message text is what keeps this endpoint from being an open
 * proxy: the caller cannot name an address the sender never posted.
 */
export function findSocialVideoUrlInText(
	text: unknown,
	requestedUrl: unknown,
): { raw: string; normalized: string } | null {
	const wanted = normalizeSocialVideoUrl(requestedUrl);
	if (!wanted) return null;
	return findSocialVideoUrlsInText(text).find((entry) => entry.normalized === wanted) || null;
}

/** Storage-relative output path. Namespaced per user; random so retries never collide. */
export function socialDownloadRelativePath(
	userId: string,
	now = Date.now(),
	random = Math.random().toString(36).slice(2, 8),
): string {
	const safeUser = String(userId || '').replace(/[^a-z0-9-]/gi, '');
	return `social/${safeUser}/video-${now}-${random}.mp4`;
}

/**
 * yt-dlp arguments.
 *
 * The URL is passed as a single argv entry after `--` and the process is spawned
 * without a shell, so no quoting or escaping is involved. `--no-playlist` keeps a
 * link that also belongs to an album from pulling hundreds of files.
 */
export function buildSocialDownloadArgs(
	url: string,
	outputPath: string,
	maxBytes = MAX_SOCIAL_VIDEO_BYTES,
	ffmpegPath = '',
	extraArgs: string[] = [],
): string[] {
	return [
		// yt-dlp needs ffmpeg to merge separate audio/video streams. Point it at the
		// binary this app already resolves instead of hoping one is on PATH.
		...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
		...extraArgs,
		'--no-playlist',
		'--no-warnings',
		'--no-progress',
		'--no-part',
		'--retries',
		'2',
		'--socket-timeout',
		'20',
		// Prefer a single already-muxed mp4 so no remux pass is needed.
		'--format',
		'best[ext=mp4][filesize<?' + maxBytes + ']/best[ext=mp4]/best',
		'--merge-output-format',
		'mp4',
		'--max-filesize',
		String(maxBytes),
		'--output',
		outputPath,
		'--',
		url,
	];
}

/** TikTok's mobile API host, used to get around a bot-checked web page. */
export const TIKTOK_API_HOSTNAME = 'api22-normal-c-useast2a.tiktokv.com';

/** A current desktop Chrome UA. TikTok serves the plain page to this one. */
export const BROWSER_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/**
 * The argument sets to try, in order, until one produces a file.
 *
 * TikTok is the reason this is a ladder rather than a single call. Its page answers
 * a JavaScript challenge before releasing the video data, and that step is where the
 * failures land ("Unexpected response from webpage request"). Each rung removes one
 * dependency of the rung before it:
 *
 * 1. the default path, which is the one TikTok keeps working for most posts;
 * 2. a real browser User-Agent with the on-disk cache bypassed — measured to skip
 *    the challenge entirely, and immune to a stale challenge cookie;
 * 3. TikTok's mobile API host, which does not involve the web page at all.
 *
 * Facebook and Instagram get the first two rungs only, and in practice never leave
 * the first, so their behaviour is unchanged.
 */
export function socialDownloadAttempts(
	platform: SocialPlatform,
	options: { tiktokApiHostname?: string; userAgent?: string } = {},
): string[][] {
	const userAgent = options.userAgent || BROWSER_USER_AGENT;
	const apiHostname = options.tiktokApiHostname || TIKTOK_API_HOSTNAME;
	const attempts: string[][] = [[], ['--no-cache-dir', '--user-agent', userAgent]];
	if (platform === 'tiktok' && apiHostname) {
		attempts.push(['--no-cache-dir', '--extractor-args', `tiktok:api_hostname=${apiHostname}`]);
	}
	return attempts;
}

/**
 * Whether a failure is worth a second attempt.
 *
 * A private post or a missing binary will fail identically every time, and retrying
 * those just doubles how long the user stares at a spinner. Extractor hiccups and
 * server-side errors are the ones that pass on their own.
 */
export function isRetryableSocialDownloadFailure(stderr: string): boolean {
	const text = String(stderr || '').toLowerCase();
	if (
		text.includes('login required') ||
		text.includes('not logged') ||
		text.includes('cookies') ||
		text.includes('enoent') ||
		text.includes('max-filesize') ||
		text.includes('video unavailable')
	) {
		return false;
	}
	return /unexpected response|unable to extract|http error 5\d\d|timed out|connection reset/.test(
		text,
	);
}

/**
 * The last `ERROR:` line yt-dlp printed, cleaned up for display.
 *
 * Without this the only thing left of a failure is the exit code, which says
 * nothing: extractors break per-platform and per-post, so the reason has to travel
 * back to whoever pressed the button.
 */
export function lastSocialDownloadError(stderr: string): string {
	const lines = String(stderr || '')
		// yt-dlp colours its output when it thinks it has a terminal.
		.replace(/\u001b\[[0-9;]*m/g, '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^error:/i.test(line));
	const last = lines[lines.length - 1];
	if (!last) return '';
	const detail = last
		.replace(/^error:\s*/i, '')
		// Bug-report boilerplate is noise for the person looking at a chat bubble.
		.replace(/[;.]?\s*(please report this issue|confirm you are on the latest version)[\s\S]*$/i, '')
		.trim();
	return detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
}

/** Turns yt-dlp's stderr into something worth showing a user. */
export function describeSocialDownloadFailure(stderr: string, exitCode: number | null): string {
	const text = String(stderr || '').toLowerCase();
	if (text.includes('login required') || text.includes('not logged') || text.includes('cookies')) {
		return 'This post is private or needs a login, so it cannot be downloaded.';
	}
	if (text.includes('unsupported url')) return 'This link does not point to a downloadable video.';
	if (text.includes('video unavailable') || text.includes('404')) {
		return 'The video is no longer available at this link.';
	}
	if (text.includes('file is larger') || text.includes('max-filesize')) {
		return 'This video is too large to download.';
	}
	if (text.includes('enoent')) {
		return 'The video downloader is not installed on the server. Run "npm run yt-dlp:install" in backend, or set YTDLP_PATH.';
	}
	const detail = lastSocialDownloadError(stderr);
	if (detail) return `Could not download this video: ${detail}`;
	return `Could not download this video${exitCode == null ? '' : ` (exit ${exitCode})`}.`;
}

/** Human title for the downloaded clip when yt-dlp gives us no metadata. */
export function socialDownloadTitle(platform: SocialPlatform, url: string): string {
	const label = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' }[platform];
	try {
		const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
		const clean = slug.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40);
		return clean ? `${label} video ${clean}` : `${label} video`;
	} catch {
		return `${label} video`;
	}
}

/** Guards a stored path against escaping the media root. */
export function resolveSocialPathInsideRoot(root: string, storagePath: string): string | null {
	const relative = String(storagePath || '').replace(/\\/g, '/');
	if (!relative || relative.includes('..') || relative.startsWith('/') || path.isAbsolute(relative)) {
		return null;
	}
	const absoluteRoot = path.resolve(root);
	const resolved = path.resolve(absoluteRoot, relative);
	if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
		return null;
	}
	return resolved;
}
