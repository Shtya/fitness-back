import {
	isWhatsAppViewOnceQuoted,
	isWhatsAppViewOnceRaw,
	stripViewOnceQuotedPreviews,
	stripViewOnceRawPreview,
} from './whatsapp-view-once';

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

describe('stripViewOnceQuotedPreviews', () => {
	const replyTo = (quotedMessage: any) => ({
		key: { id: 'reply' },
		message: {
			extendedTextMessage: {
				text: 'nice',
				contextInfo: { stanzaId: 'Q1', quotedMessage },
			},
		},
	});

	it('detects quoted view-once copies, wrapped or flagged', () => {
		expect(isWhatsAppViewOnceQuoted({ viewOnceMessageV2: { message: { imageMessage: {} } } })).toBe(true);
		expect(isWhatsAppViewOnceQuoted({ imageMessage: { viewOnce: true } })).toBe(true);
		expect(isWhatsAppViewOnceQuoted({ imageMessage: { caption: 'x' } })).toBe(false);
		expect(isWhatsAppViewOnceQuoted(undefined)).toBe(false);
	});

	it('drops the caption and thumbnail of a quoted view-once photo', () => {
		const raw = replyTo({
			viewOnceMessageV2: {
				message: { imageMessage: { viewOnce: true, caption: 'private', jpegThumbnail: 'abc', mimetype: 'image/jpeg' } },
			},
		});
		const result = stripViewOnceQuotedPreviews(raw) as any;
		expect(result).not.toBe(raw);
		const quoted = result.message.extendedTextMessage.contextInfo.quotedMessage;
		expect(quoted.viewOnceMessageV2.message.imageMessage).toEqual({ viewOnce: true, mimetype: 'image/jpeg' });
		expect(result.message.extendedTextMessage.text).toBe('nice');
		expect(JSON.stringify(result)).not.toContain('private');
		expect(raw.message.extendedTextMessage.contextInfo.quotedMessage.viewOnceMessageV2.message.imageMessage.caption).toBe(
			'private',
		);
	});

	it('returns the same object when no view-once message is quoted', () => {
		const raw = replyTo({ imageMessage: { caption: 'public', jpegThumbnail: 'abc' } });
		expect(stripViewOnceQuotedPreviews(raw)).toBe(raw);
		expect(stripViewOnceQuotedPreviews(null)).toBeNull();
	});
});
