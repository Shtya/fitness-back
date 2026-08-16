import * as path from 'path';
import {
	isPathInside,
	mediaRelativeKey,
	stickerFileCandidates,
	stickerPathTail,
} from './whatsapp-sticker-path';

describe('sticker path resolution', () => {
	it('extracts a portable media-relative key from mixed env paths', () => {
		expect(mediaRelativeKey('storage/whatsapp-media/stickers/acc/user/ab.webp')).toBe(
			'stickers/acc/user/ab.webp',
		);
		expect(
			stickerPathTail('E:/.env/Me/So7baFit/backend/storage/whatsapp-media/stickers/acc/user/ab.webp'),
		).toBe('stickers/acc/user/ab.webp');
		expect(mediaRelativeKey('/var/www/app/storage/whatsapp-media/acc/file.webp')).toBe(
			'acc/file.webp',
		);
	});

	it('resolves cwd-relative and media-root-relative keys', () => {
		const cwd = 'E:\\app\\backend';
		const mediaRoot = 'E:\\app\\backend\\storage\\whatsapp-media';
		const candidates = stickerFileCandidates('stickers/acc/user/ab.webp', { cwd, mediaRoot });
		expect(
			candidates.some((item) => item.endsWith(path.join('stickers', 'acc', 'user', 'ab.webp'))),
		).toBe(true);
	});

	it('maps a foreign absolute path onto the current media root', () => {
		const candidates = stickerFileCandidates(
			'/opt/so7bafit/backend/storage/whatsapp-media/stickers/acc/user/ab.webp',
			{
				cwd: 'E:\\app\\backend',
				mediaRoot: 'E:\\app\\backend\\storage\\whatsapp-media',
			},
		);
		expect(
			candidates.some((item) =>
				item.replace(/\\/g, '/').endsWith('storage/whatsapp-media/stickers/acc/user/ab.webp'),
			),
		).toBe(true);
	});

	it('accepts files under the media root only', () => {
		const root = path.resolve('/var/data/wa-media');
		expect(isPathInside(path.join(root, 'stickers', 'a.webp'), root)).toBe(true);
		expect(isPathInside(path.resolve('/tmp/evil.webp'), root)).toBe(false);
	});
});
