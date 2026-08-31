import { redactMessagesRawForClient, redactRawForClient } from './whatsapp-raw-redact';

describe('redactRawForClient', () => {
	it('strips media decryption material at every depth', () => {
		const raw = {
			key: { id: 'ABC', remoteJid: '2010000@c.us' },
			message: {
				imageMessage: {
					url: 'https://mmg.whatsapp.net/x',
					mimetype: 'image/jpeg',
					mediaKey: 'c2VjcmV0',
					fileSha256: 'aGFzaA==',
					fileEncSha256: 'ZW5jaGFzaA==',
					directPath: '/v/t62.7118-24/x.enc',
					caption: 'hello',
				},
			},
		};

		const result = redactRawForClient(raw) as any;

		expect(result.message.imageMessage.mediaKey).toBeUndefined();
		expect(result.message.imageMessage.fileSha256).toBeUndefined();
		expect(result.message.imageMessage.fileEncSha256).toBeUndefined();
		expect(result.message.imageMessage.directPath).toBeUndefined();
	});

	it('keeps the fields the chat UI renders', () => {
		const raw = {
			pushName: 'Ahmed',
			message: {
				imageMessage: {
					mediaKey: 'c2VjcmV0',
					// The bubbles use this as the blurred placeholder fallback.
					jpegThumbnail: 'BASE64THUMB',
					caption: 'hello',
					contextInfo: { stanzaId: 'QUOTED', mentionedJid: ['2010000@c.us'] },
				},
			},
		};

		const result = redactRawForClient(raw) as any;

		expect(result.pushName).toBe('Ahmed');
		expect(result.message.imageMessage.jpegThumbnail).toBe('BASE64THUMB');
		expect(result.message.imageMessage.caption).toBe('hello');
		expect(result.message.imageMessage.contextInfo.stanzaId).toBe('QUOTED');
		expect(result.message.imageMessage.contextInfo.mentionedJid).toEqual(['2010000@c.us']);
	});

	it('does not mutate the caller entity, so DB-backed re-downloads still work', () => {
		const raw = { message: { audioMessage: { mediaKey: 'c2VjcmV0' } } };

		redactRawForClient(raw);

		expect(raw.message.audioMessage.mediaKey).toBe('c2VjcmV0');
	});

	it('passes through primitives, arrays and buffers', () => {
		expect(redactRawForClient(null)).toBeNull();
		expect(redactRawForClient('text')).toBe('text');
		const buffer = Buffer.from('abc');
		expect(redactRawForClient({ b: buffer }).b).toBe(buffer);
		expect(redactRawForClient([{ mediaKey: 'x', ok: 1 }])).toEqual([{ ok: 1 }]);
	});

	it('redacts the raw column of a message list', () => {
		const messages = [
			{ id: 'm1', raw: { message: { videoMessage: { mediaKey: 'k', url: 'u' } } } },
			{ id: 'm2', raw: null },
		];

		const result = redactMessagesRawForClient(messages as any) as any[];

		expect(result[0].raw.message.videoMessage.mediaKey).toBeUndefined();
		expect(result[0].raw.message.videoMessage.url).toBe('u');
		expect(result[1].raw).toBeNull();
	});
});
