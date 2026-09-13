import {
	decodeProviderMedia,
	isIncompleteChatImageDownload,
	isIncompleteStatusMedia,
} from './whatsapp-media-decode';

describe('decodeProviderMedia', () => {
	it('returns a Buffer payload without re-encoding it as base64', () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		expect(decodeProviderMedia({ data: jpeg })).toEqual(jpeg);
	});

	it('decodes a data URI', () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
		const decoded = decodeProviderMedia(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
		expect(decoded).toEqual(jpeg);
	});
});

describe('isIncompleteStatusMedia', () => {
	it('rejects a video status that only produced a JPEG thumbnail', () => {
		const jpeg = Buffer.alloc(12_000, 0xff);
		jpeg[0] = 0xff;
		jpeg[1] = 0xd8;
		jpeg[2] = 0xff;
		expect(isIncompleteStatusMedia(jpeg, 'image/jpeg', 'video')).toBe(true);
	});

	it('rejects a tiny JPEG that is almost certainly a WhatsApp thumbnail', () => {
		expect(isIncompleteStatusMedia(Buffer.alloc(2_000), 'image/jpeg', 'image')).toBe(true);
	});

	it('accepts a full-size image status', () => {
		expect(isIncompleteStatusMedia(Buffer.alloc(40_000), 'image/jpeg', 'image')).toBe(false);
	});
});

describe('isIncompleteChatImageDownload', () => {
	it('rejects tiny image payloads', () => {
		expect(
			isIncompleteChatImageDownload(2_000, { type: 'image', mimeType: 'image/jpeg' }),
		).toBe(true);
	});

	it('rejects a thumbnail-sized buffer when WhatsApp reported a large fileLength', () => {
		expect(
			isIncompleteChatImageDownload(10_000, {
				type: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: 180_000,
			}),
		).toBe(true);
	});

	it('never rejects stickers for being small', () => {
		expect(
			isIncompleteChatImageDownload(2_000, { type: 'sticker', mimeType: 'image/webp' }),
		).toBe(false);
	});

	it('accepts a normal photo size', () => {
		expect(
			isIncompleteChatImageDownload(95_000, {
				type: 'image',
				mimeType: 'image/jpeg',
				fileSizeBytes: 95_000,
			}),
		).toBe(false);
	});
});
