jest.mock('./baileys-loader', () => ({
	loadBaileysModule: async () => ({
		downloadContentFromMessage: async () => {
			throw new Error('CDN 410 gone');
		},
		downloadMediaMessage: async () => {
			throw new Error('library download failed');
		},
		getUrlFromDirectPath: (directPath: string) => `https://mmg.whatsapp.net${directPath}`,
	}),
}));

import { BaileysProvider } from './baileys.provider';

function connectedProvider(socket: Record<string, unknown>) {
	const provider = new BaileysProvider('acc-phone') as any;
	provider.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
	provider.socket = socket;
	provider.state = 'connected';
	return provider;
}

function expiredImage(id = 'MEDIA-1') {
	return {
		key: { id, remoteJid: '97455500000@s.whatsapp.net', fromMe: false },
		message: {
			imageMessage: {
				mimetype: 'image/jpeg',
				mediaKey: Buffer.alloc(32, 1),
				directPath: '/v/t62.7118-24/expired',
				fileLength: 1000,
			},
		},
	};
}

describe('Baileys phone requests ("Syncing … stopped" on the phone)', () => {
	it('background message lookups never ask the phone for history or a resend', async () => {
		const socket = {
			fetchMessageHistory: jest.fn(async () => undefined),
			requestPlaceholderResend: jest.fn(async () => 'req-1'),
		};
		const provider = connectedProvider(socket);
		provider.messagesByChat.set(
			'97455500000@c.us',
			new Map([
				[
					'OTHER',
					{
						providerMessageId: 'OTHER',
						chatId: '97455500000@c.us',
						fromMe: false,
						timestamp: new Date(),
					},
				],
			]),
		);
		await provider.fetchMessage('97455500000@c.us', 'CARD-1', {
			accept: () => false,
			allowPhoneRequest: false,
		});
		await provider.fetchMessage('97455500000@c.us', 'CARD-1');
		expect(socket.fetchMessageHistory).not.toHaveBeenCalled();
		expect(socket.requestPlaceholderResend).not.toHaveBeenCalled();
	});

	it('a user-opened lookup asks the phone at most once per message', async () => {
		const socket = {
			requestPlaceholderResend: jest.fn(async () => 'req-1'),
		};
		const provider = connectedProvider(socket);
		await provider.fetchMessage('97455500000@c.us', 'LOC-1', { allowPhoneRequest: true });
		await provider.fetchMessage('97455500000@c.us', 'LOC-1', { allowPhoneRequest: true });
		expect(socket.requestPlaceholderResend).toHaveBeenCalledTimes(1);
		const lines = provider.logger.log.mock.calls.map((call: unknown[]) => String(call[0]));
		expect(lines.some((line: string) => line.includes('outcome=skipped_duplicate'))).toBe(true);
	});

	it('prefetch downloads of expired media do not ask the phone to re-upload', async () => {
		const socket = { updateMediaMessage: jest.fn(async (raw: any) => raw) };
		const provider = connectedProvider(socket);
		await expect(
			provider.downloadMedia('MEDIA-1', { rawHint: expiredImage() }),
		).rejects.toThrow(/re-upload only when you open it/);
		expect(socket.updateMediaMessage).not.toHaveBeenCalled();
	});

	it('a user-opened download may ask the phone once; a repeat waits for the cooldown', async () => {
		const socket = { updateMediaMessage: jest.fn(async () => ({ message: null })) };
		const provider = connectedProvider(socket);
		await expect(
			provider.downloadMedia('MEDIA-2', {
				rawHint: expiredImage('MEDIA-2'),
				allowPhoneRequest: true,
			}),
		).rejects.toThrow(/did not re-upload/);
		await expect(
			provider.downloadMedia('MEDIA-2', {
				rawHint: expiredImage('MEDIA-2'),
				allowPhoneRequest: true,
			}),
		).rejects.toThrow(/already asked/);
		expect(socket.updateMediaMessage).toHaveBeenCalledTimes(1);
	});

	it('story prefetch does not send placeholder resends for stories missing from RAM', async () => {
		const socket = { requestPlaceholderResend: jest.fn(async () => 'req-1') };
		const provider = connectedProvider(socket);
		await expect(
			provider.downloadStatus('false_status@broadcast_3EB0STORY_97455500000@s.whatsapp.net'),
		).rejects.toThrow(/session cache/);
		expect(socket.requestPlaceholderResend).not.toHaveBeenCalled();
	});
});
