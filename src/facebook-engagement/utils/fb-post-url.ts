export type FbObjectKind = 'post' | 'photo' | 'video';

export type ParsedFbPostRef =
	| {
			ok: true;
			kind: FbObjectKind;
			objectId: string;
			pageHint: string | null;
			candidates: string[];
			normalizedUrl: string | null;
	  }
	| {
			ok: false;
			reason: 'EMPTY' | 'INVALID_URL' | 'NOT_FACEBOOK' | 'SHORT_LINK' | 'NOT_PAGE_CONTENT' | 'NO_POST_ID';
	  };

const FACEBOOK_HOST = /^(?:(?:www|m|mbasic|web|business|touch)\.)?(?:facebook\.com|fb\.com)$/i;
const SHORT_HOSTS = /^(?:fb\.watch|fb\.me|on\.fb\.me)$/i;
const NUMERIC = /^\d{5,}$/;
const COMPOSITE = /^(\d{5,})_(\d{5,})$/;
const PFBID = /^pfbid[0-9A-Za-z]{10,}$/;

function uniq(values: string[]) {
	return [...new Set(values.filter(Boolean))];
}

function ok(
	kind: FbObjectKind,
	objectId: string,
	pageHint: string | null,
	normalizedUrl: string | null,
): ParsedFbPostRef {
	const candidates: string[] = [];
	if (pageHint && NUMERIC.test(pageHint) && NUMERIC.test(objectId)) {
		candidates.push(`${pageHint}_${objectId}`);
	}
	candidates.push(objectId);
	return { ok: true, kind, objectId, pageHint, candidates: uniq(candidates), normalizedUrl };
}

function lastNumericSegment(segments: string[]) {
	for (let i = segments.length - 1; i >= 0; i -= 1) {
		if (NUMERIC.test(segments[i])) return segments[i];
	}
	return null;
}

export function normalizeFacebookPath(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (!FACEBOOK_HOST.test(parsed.hostname)) return null;
		return parsed.pathname.replace(/\/+$/, '').toLowerCase();
	} catch {
		return null;
	}
}

export function parseFacebookPostRef(input: string | null | undefined): ParsedFbPostRef {
	const raw = String(input ?? '').trim();
	if (!raw) return { ok: false, reason: 'EMPTY' };

	const composite = raw.match(COMPOSITE);
	if (composite) {
		return { ok: true, kind: 'post', objectId: composite[2], pageHint: composite[1], candidates: [raw], normalizedUrl: null };
	}
	if (NUMERIC.test(raw)) return ok('post', raw, null, null);

	let url: URL;
	try {
		url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return { ok: false, reason: 'INVALID_URL' };
	}

	const host = url.hostname.toLowerCase();
	if (SHORT_HOSTS.test(host)) return { ok: false, reason: 'SHORT_LINK' };
	if (!FACEBOOK_HOST.test(host)) return { ok: false, reason: 'NOT_FACEBOOK' };

	const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
	const first = (segments[0] ?? '').toLowerCase();
	const params = url.searchParams;
	const normalizedUrl = `https://www.facebook.com${url.pathname.replace(/\/+$/, '')}`;

	if (first === 'share') return { ok: false, reason: 'SHORT_LINK' };
	if (first === 'groups' || first === 'events' || first === 'marketplace') {
		return { ok: false, reason: 'NOT_PAGE_CONTENT' };
	}

	if (first === 'permalink.php' || first === 'story.php') {
		const storyId = params.get('story_fbid');
		const pageId = params.get('id');
		if (storyId && (NUMERIC.test(storyId) || PFBID.test(storyId))) {
			return ok('post', storyId, pageId && NUMERIC.test(pageId) ? pageId : null, normalizedUrl);
		}
		return { ok: false, reason: 'NO_POST_ID' };
	}

	if (first === 'photo' || first === 'photo.php') {
		const fbid = params.get('fbid');
		return fbid && NUMERIC.test(fbid) ? ok('photo', fbid, null, normalizedUrl) : { ok: false, reason: 'NO_POST_ID' };
	}

	if (first === 'watch') {
		const videoId = params.get('v');
		return videoId && NUMERIC.test(videoId)
			? ok('video', videoId, null, normalizedUrl)
			: { ok: false, reason: 'NO_POST_ID' };
	}

	if (first === 'reel' || first === 'reels') {
		const reelId = segments[1];
		return reelId && NUMERIC.test(reelId) ? ok('video', reelId, null, normalizedUrl) : { ok: false, reason: 'NO_POST_ID' };
	}

	const pageHint = segments[0] ?? null;
	const section = (segments[1] ?? '').toLowerCase();

	if (section === 'posts') {
		const postId = segments[2];
		if (postId && (NUMERIC.test(postId) || PFBID.test(postId))) {
			return ok('post', postId, pageHint, normalizedUrl);
		}
		return { ok: false, reason: 'NO_POST_ID' };
	}

	if (section === 'photos') {
		const fbid = params.get('fbid') ?? lastNumericSegment(segments.slice(2));
		return fbid ? ok('photo', fbid, pageHint, normalizedUrl) : { ok: false, reason: 'NO_POST_ID' };
	}

	if (section === 'videos') {
		const videoId = lastNumericSegment(segments.slice(2));
		return videoId ? ok('video', videoId, pageHint, normalizedUrl) : { ok: false, reason: 'NO_POST_ID' };
	}

	const storyId = params.get('story_fbid') ?? params.get('fbid');
	if (storyId && NUMERIC.test(storyId)) return ok('post', storyId, pageHint, normalizedUrl);

	return { ok: false, reason: 'NO_POST_ID' };
}

export const POST_REF_ERROR_MESSAGES: Record<Exclude<ParsedFbPostRef, { ok: true }>['reason'], string> = {
	EMPTY: 'Paste a Facebook post link.',
	INVALID_URL: 'This does not look like a valid link.',
	NOT_FACEBOOK: 'Only facebook.com post links are supported.',
	SHORT_LINK:
		'Share / short links (facebook.com/share, fb.watch) cannot be resolved. Open the post and copy its full link, or pick it from the list.',
	NOT_PAGE_CONTENT: 'Only posts published by your Pages are supported (not groups, events or marketplace).',
	NO_POST_ID: 'Could not find a post ID in this link. Pick the post from the list instead.',
};
