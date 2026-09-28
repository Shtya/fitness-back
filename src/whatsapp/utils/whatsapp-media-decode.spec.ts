import {
	decodeProviderMedia,
	isIncompleteChatImageDownload,
	isIncompleteStatusMedia,
	readFileHeader,
} from './whatsapp-media-decode';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('readFileHeader (audit A7)', () => {
	it('returns only the requested prefix, or the whole file when shorter', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wa-header-'));
		const big = path.join(dir, 'big.bin');
		await fs.writeFile(big, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(4096, 1)]));
		const small = path.join(dir, 'small.bin');
		await fs.writeFile(small, Buffer.from('ab'));

		const header = await readFileHeader(big, 256);
		expect(header.length).toBe(256);
		expect(header.subarray(0, 4).toString('ascii')).toBe('OggS');
		expect((await readFileHeader(small, 256)).toString('ascii')).toBe('ab');
		await expect(readFileHeader(path.join(dir, 'missing.bin'), 4)).rejects.toThrow();

		await fs.rm(dir, { recursive: true, force: true });
	});
});

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
