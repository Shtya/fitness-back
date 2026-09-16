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
	const found = new Set<string>();
	// Mirrors the frontend's `MESSAGE_URL_PATTERN`, including the schemeless bare-host
	// form (`tiktok.com/@a/video/1`). If this were narrower, the UI would offer a
	// download the server then rejects as "not part of this message".
	const pattern =
		/(?:https?:\/\/|www\.)[^\s<>"']+|(?:(?:m\.|www\.)?(?:facebook|instagram|tiktok)\.com|fb\.watch|instagr\.am|fb\.com)\/[^\s<>"']+/gi;
	for (const raw of String(text || '').match(pattern) || []) {
		const trimmed = raw.replace(/[),.!?;:\]}]+$/, '');
		const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
		const normalized = normalizeSocialVideoUrl(candidate);
		if (normalized) found.add(normalized);
	}
	return [...found];
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
): string[] {
	return [
		// yt-dlp needs ffmpeg to merge separate audio/video streams. Point it at the
		// binary this app already resolves instead of hoping one is on PATH.
		...(ffmpegPath ? ['--ffmpeg-location', ffmpegPath] : []),
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
