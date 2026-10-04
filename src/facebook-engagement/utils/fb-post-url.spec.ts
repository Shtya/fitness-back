import { normalizeFacebookPath, parseFacebookPostRef } from './fb-post-url';

describe('parseFacebookPostRef', () => {
	it('accepts raw composite and numeric ids', () => {
		expect(parseFacebookPostRef('123456_987654')).toMatchObject({
			ok: true,
			objectId: '987654',
			pageHint: '123456',
			candidates: ['123456_987654'],
		});
		expect(parseFacebookPostRef('9876543210')).toMatchObject({ ok: true, kind: 'post', candidates: ['9876543210'] });
	});

	it('parses /{page}/posts/{id} links with a numeric page', () => {
		expect(parseFacebookPostRef('https://www.facebook.com/1122334455/posts/9988776655/')).toMatchObject({
			ok: true,
			kind: 'post',
			objectId: '9988776655',
			candidates: ['1122334455_9988776655', '9988776655'],
		});
	});

	it('parses username post links and pfbid ids', () => {
		const parsed = parseFacebookPostRef('facebook.com/so7bafit/posts/pfbid02abcDEFghiJKLmnoPQR');
		expect(parsed).toMatchObject({ ok: true, kind: 'post', pageHint: 'so7bafit', candidates: ['pfbid02abcDEFghiJKLmnoPQR'] });
	});

	it('parses permalink.php and story.php', () => {
		expect(
			parseFacebookPostRef('https://m.facebook.com/permalink.php?story_fbid=55555666&id=11112222'),
		).toMatchObject({ ok: true, objectId: '55555666', candidates: ['11112222_55555666', '55555666'] });
		expect(parseFacebookPostRef('https://www.facebook.com/story.php?story_fbid=55555666&id=11112222')).toMatchObject({
			ok: true,
			objectId: '55555666',
		});
	});

	it('parses photos, videos, watch and reels', () => {
		expect(parseFacebookPostRef('https://www.facebook.com/photo/?fbid=44445555')).toMatchObject({ kind: 'photo', objectId: '44445555' });
		expect(parseFacebookPostRef('https://www.facebook.com/page/photos/a.1234567/7654321/')).toMatchObject({
			kind: 'photo',
			objectId: '7654321',
		});
		expect(parseFacebookPostRef('https://www.facebook.com/page/videos/some-title/33334444/')).toMatchObject({
			kind: 'video',
			objectId: '33334444',
		});
		expect(parseFacebookPostRef('https://www.facebook.com/watch/?v=22223333')).toMatchObject({ kind: 'video', objectId: '22223333' });
		expect(parseFacebookPostRef('https://www.facebook.com/reel/11112222')).toMatchObject({ kind: 'video', objectId: '11112222' });
	});

	it('rejects short, foreign, group and id-less links with a reason', () => {
		expect(parseFacebookPostRef('')).toEqual({ ok: false, reason: 'EMPTY' });
		expect(parseFacebookPostRef('https://fb.watch/abc123/')).toEqual({ ok: false, reason: 'SHORT_LINK' });
		expect(parseFacebookPostRef('https://www.facebook.com/share/p/1AbCdEf/')).toEqual({ ok: false, reason: 'SHORT_LINK' });
		expect(parseFacebookPostRef('https://example.com/posts/123456')).toEqual({ ok: false, reason: 'NOT_FACEBOOK' });
		expect(parseFacebookPostRef('https://www.facebook.com/groups/12345/posts/67890')).toEqual({
			ok: false,
			reason: 'NOT_PAGE_CONTENT',
		});
		expect(parseFacebookPostRef('https://www.facebook.com/so7bafit')).toEqual({ ok: false, reason: 'NO_POST_ID' });
		expect(parseFacebookPostRef('not a url at all')).toEqual({ ok: false, reason: 'INVALID_URL' });
	});
});

describe('normalizeFacebookPath', () => {
	it('lowercases and strips trailing slashes for facebook hosts only', () => {
		expect(normalizeFacebookPath('https://m.facebook.com/So7baFit/posts/123/')).toBe('/so7bafit/posts/123');
		expect(normalizeFacebookPath('https://example.com/a')).toBeNull();
	});
});
