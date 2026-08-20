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

	it('keeps location coordinates and map thumbnail', () => {
		const sanitized = sanitizeBaileysWaMessage({
			key: {
				remoteJid: '201000000000@s.whatsapp.net',
				id: 'loc-1',
				fromMe: false,
			},
			pushName: 'My Bro',
			messageTimestamp: 1710000002,
			message: {
				locationMessage: {
					degreesLatitude: 30.0444,
					degreesLongitude: 31.2357,
					name: 'Cairo',
					address: 'Tahrir Square',
					jpegThumbnail: Buffer.from('mapthumb'),
				},
			},
		}) as any;

		expect(sanitized?.message?.locationMessage?.degreesLatitude).toBe(30.0444);
		expect(sanitized?.message?.locationMessage?.degreesLongitude).toBe(31.2357);
		expect(sanitized?.message?.locationMessage?.name).toBe('Cairo');
		expect(sanitized?.message?.locationMessage?.jpegThumbnail).toBe(
			Buffer.from('mapthumb').toString('base64'),
		);
	});

	it('converts protobuf Long coordinates and does not store NaN', () => {
		const sanitized = sanitizeBaileysWaMessage({
			key: {
				remoteJid: '201000000000@s.whatsapp.net',
				id: 'loc-2',
				fromMe: false,
			},
			messageTimestamp: 1710000003,
			message: {
				locationMessage: {
					degreesLatitude: { value: 30.0444 },
					degreesLongitude: { nested: true },
					name: 'Cairo',
				},
			},
		}) as any;

		expect(sanitized?.message?.locationMessage?.degreesLatitude).toBe(30.0444);
		expect(sanitized?.message?.locationMessage?.degreesLongitude).toBeUndefined();
		expect(Number.isNaN(sanitized?.message?.locationMessage?.degreesLongitude)).toBe(false);
		expect(sanitized?.message?.locationMessage?.name).toBe('Cairo');
	});
});
