import { sanitizeBaileysWaMessage } from './baileys-media-raw';

describe('sanitizeBaileysWaMessage', () => {
	it('keeps group sender pushName and quoted image thumbnail on text replies', () => {
		const sanitized = sanitizeBaileysWaMessage({
			key: {
				remoteJid: '120363@g.us',
				id: 'msg-1',
				fromMe: false,
				participant: '246896262172848@lid',
			},
			pushName: 'Ahmed',
			messageTimestamp: 1710000000,
			message: {
				extendedTextMessage: {
					text: 'Please check @246896262172848',
					contextInfo: {
						stanzaId: 'quoted-1',
						participant: '201000000000@s.whatsapp.net',
						mentionedJid: ['246896262172848@lid'],
						quotedMessage: {
							imageMessage: {
								mimetype: 'image/jpeg',
								jpegThumbnail: Buffer.from('thumb'),
							},
						},
					},
				},
			},
		}) as any;

		expect(sanitized?.pushName).toBe('Ahmed');
		expect(sanitized?.message?.extendedTextMessage?.text).toBe(
			'Please check @246896262172848',
		);
		expect(sanitized?.message?.extendedTextMessage?.contextInfo?.mentionedJid).toEqual([
			'246896262172848@lid',
		]);
		expect(
			sanitized?.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage
				?.jpegThumbnail,
		).toBe(Buffer.from('thumb').toString('base64'));
	});

	it('marks forwarded video messages from contextInfo', () => {
		const sanitized = sanitizeBaileysWaMessage({
			key: {
				remoteJid: '120363@g.us',
				id: 'msg-2',
				fromMe: false,
				participant: '201000000000@s.whatsapp.net',
			},
			pushName: 'Sara',
			messageTimestamp: 1710000001,
			message: {
				videoMessage: {
					mimetype: 'video/mp4',
					jpegThumbnail: Buffer.from('vthumb'),
					contextInfo: {
						isForwarded: true,
						forwardingScore: 2,
					},
				},
			},
		}) as any;

		expect(sanitized?.pushName).toBe('Sara');
		expect(sanitized?.message?.videoMessage?.contextInfo?.isForwarded).toBe(true);
		expect(sanitized?.message?.videoMessage?.jpegThumbnail).toBe(
			Buffer.from('vthumb').toString('base64'),
		);
	});
});
