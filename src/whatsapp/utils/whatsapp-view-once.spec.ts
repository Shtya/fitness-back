import { isWhatsAppViewOnceRaw, stripViewOnceRawPreview } from './whatsapp-view-once';

describe('isWhatsAppViewOnceRaw', () => {
	it('detects the flag on an unwrapped media node (how Baileys rows are stored)', () => {
		expect(isWhatsAppViewOnceRaw({ message: { imageMessage: { viewOnce: true } } })).toBe(true);
		expect(isWhatsAppViewOnceRaw({ message: { videoMessage: { viewOnce: true } } })).toBe(true);
		expect(isWhatsAppViewOnceRaw({ message: { audioMessage: { viewOnce: true, ptt: true } } })).toBe(true);
	});

	it('detects view-once wrappers, including inside disappearing messages', () => {
		expect(isWhatsAppViewOnceRaw({ message: { viewOnceMessageV2: { message: { imageMessage: {} } } } })).toBe(true);
		expect(
			isWhatsAppViewOnceRaw({
				message: { ephemeralMessage: { message: { viewOnceMessage: { message: { videoMessage: {} } } } } },
			}),
		).toBe(true);
		expect(isWhatsAppViewOnceRaw({ isViewOnce: true })).toBe(true);
	});

	it('leaves ordinary media alone', () => {
		expect(isWhatsAppViewOnceRaw({ message: { imageMessage: { viewOnce: false } } })).toBe(false);
		expect(isWhatsAppViewOnceRaw({ message: { imageMessage: {} } })).toBe(false);
		expect(isWhatsAppViewOnceRaw({ message: { documentMessage: { viewOnce: true } } })).toBe(false);
		expect(isWhatsAppViewOnceRaw(null)).toBe(false);
	});
});

describe('stripViewOnceRawPreview', () => {
	it('removes inline thumbnails without mutating the source', () => {
		const raw = {
			key: { id: 'x' },
			message: {
				imageMessage: { viewOnce: true, jpegThumbnail: 'abc', caption: 'hi', mimetype: 'image/jpeg' },
				viewOnceMessageV2: { message: { videoMessage: { jpegThumbnail: 'def', seconds: 3 } } },
			},
			body: 'data:image/jpeg;base64,abc',
		};
		const result = stripViewOnceRawPreview(raw) as any;
		expect(result.message.imageMessage).toEqual({ viewOnce: true, mimetype: 'image/jpeg' });
		expect(result.message.viewOnceMessageV2.message.videoMessage).toEqual({ seconds: 3 });
		expect(result.body).toBeUndefined();
		expect(raw.message.imageMessage.jpegThumbnail).toBe('abc');
	});
});
