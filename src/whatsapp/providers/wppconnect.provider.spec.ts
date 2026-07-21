import { isStatusMessage, WppConnectProvider } from './wppconnect.provider';

describe('WppConnectProvider message normalization', () => {
	function providerWithMessages(messages: any[]) {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).client = {
			getMessages: jest.fn().mockResolvedValue(messages),
		};
		return provider;
	}

	it('normalizes chat messages and stable identifiers', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'message-1', fromMe: false },
				from: { _serialized: '201000000000@c.us' },
				type: 'chat',
				body: 'hello',
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');

		expect(message).toMatchObject({
			providerMessageId: 'message-1',
			chatId: '201000000000@c.us',
			type: 'text',
			text: 'hello',
			fromMe: false,
			timestampReliable: true,
		});
	});

	it('normalizes the provider quotedMsgId used by incoming replies', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'message-2', fromMe: false },
				from: '201000000000@c.us',
				type: 'chat',
				body: 'reply',
				quotedMsgId: 'message-1',
				timestamp: 1_700_000_001,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');
		expect(message.quotedProviderMessageId).toBe('message-1');
	});

	it('sends and normalizes message reactions', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendReactionToMessage = jest.fn().mockResolvedValue({ ok: true });
		(provider as any).client = {
			sendReactionToMessage,
			getReactions: jest.fn().mockResolvedValue({
				reactionByMe: {
					reactionText: '❤️',
					senderUserJid: 'self@c.us',
					timestamp: 1_700_000_000,
				},
				reactions: [],
			}),
		};

		await provider.sendReaction('message-1', '❤️');
		const reactions = await provider.getReactions('message-1');

		expect(sendReactionToMessage).toHaveBeenCalledWith('message-1', '❤️');
		expect(reactions).toEqual([
			expect.objectContaining({ actorKey: 'me', emoji: '❤️' }),
		]);
	});

	it('forwards, deletes and stars messages with provider-safe arguments', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const forwardMessagesV2 = jest.fn().mockResolvedValue([{ id: 'forwarded-1' }]);
		const deleteMessage = jest.fn().mockResolvedValue(true);
		const starMessage = jest.fn().mockResolvedValue(1);
		(provider as any).client = { forwardMessagesV2, deleteMessage, starMessage };

		await provider.forwardMessage('target@c.us', 'message-1');
		await provider.deleteMessage('source@c.us', 'message-1', 'everyone');
		await provider.deleteMessage('source@c.us', 'message-1', 'local');
		await provider.starMessage('message-1', true);

		expect(forwardMessagesV2).toHaveBeenCalledWith('target@c.us', 'message-1', {
			displayCaptionText: true,
		});
		expect(deleteMessage).toHaveBeenNthCalledWith(
			1,
			'source@c.us',
			'message-1',
			false,
			true,
		);
		expect(deleteMessage).toHaveBeenNthCalledWith(
			2,
			'source@c.us',
			'message-1',
			true,
			true,
		);
		expect(starMessage).toHaveBeenCalledWith('message-1', true);
	});

	it('uses the page API for message pin and acknowledgement info', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const evaluate = jest
			.fn()
			.mockResolvedValueOnce({ pinned: true })
			.mockResolvedValueOnce({ ack: 3, readRemaining: 0 });
		(provider as any).client = {
			page: { evaluate },
			getMessageById: jest.fn().mockResolvedValue({
				id: { _serialized: 'message-1', fromMe: true },
				type: 'chat',
				timestamp: 1_700_000_000,
				ack: 3,
			}),
		};

		await provider.pinMessage('message-1', true);
		const info = await provider.getMessageInfo('message-1');

		expect(evaluate).toHaveBeenNthCalledWith(
			1,
			expect.any(Function),
			{ messageId: 'message-1', shouldPin: true },
		);
		expect(evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), 'message-1');
		expect(info).toMatchObject({
			message: { id: 'message-1', fromMe: true, ack: 3 },
			acknowledgements: { readRemaining: 0 },
		});
	});

	it('recognizes incoming status messages as story updates', () => {
		expect(
			isStatusMessage({
				isStatusV3: true,
				id: { remote: 'status@broadcast' },
			}),
		).toBe(true);
		expect(isStatusMessage({ from: '201000000000@c.us' })).toBe(false);
	});

	it('normalizes PTT to audio and preserves provider duration as a fallback filename', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'voice-1' },
				from: '201000000000@c.us',
				type: 'ptt',
				mimetype: 'audio/ogg; codecs=opus',
				duration: 12.4,
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');

		expect(message.type).toBe('audio');
		expect(message.attachments).toEqual([
			expect.objectContaining({
				type: 'audio',
				mimeType: 'audio/ogg; codecs=opus',
				fileName: 'voice-12s.ogg',
			}),
		]);
	});

	it('does not expose large base64 media payloads as message text', async () => {
		const provider = providerWithMessages([
			{
				id: { _serialized: 'image-1' },
				from: '201000000000@c.us',
				type: 'image',
				body: 'data:image/jpeg;base64,' + 'a'.repeat(500),
				timestamp: 1_700_000_000,
			},
		]);

		const [message] = await provider.getMessages('201000000000@c.us');
		expect(message.text).toBeNull();
	});

	it('passes bounded history options to the WPP client', async () => {
		const provider = providerWithMessages([]);
		await provider.getMessages('chat@g.us', { limit: 500, before: 'cursor-1' });
		expect((provider as any).client.getMessages).toHaveBeenCalledWith('chat@g.us', {
			count: 100,
			id: 'cursor-1',
			direction: 'before',
		});
	});

	it('uses listChats without falling back to deprecated getAllChats', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const listChats = jest
			.fn()
			.mockResolvedValue([{ id: { _serialized: '201000000000@c.us' } }]);
		const getAllChats = jest.fn();
		(provider as any).client = { listChats, getAllChats };

		await expect(provider.getChats(50)).resolves.toHaveLength(1);
		expect(listChats).toHaveBeenCalledWith({ count: 50 });
		expect(getAllChats).not.toHaveBeenCalled();
	});

	it('accepts a new QR when the previously connected session is no longer authenticated', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).state = 'connected';
		(provider as any).client = {
			isAuthenticated: jest.fn().mockResolvedValue(false),
		};

		await (provider as any).publishQr('data:image/png;base64,new-qr');

		expect(provider.getState()).toBe('qr_pending');
		expect(provider.getQr()).toBe('data:image/png;base64,new-qr');
	});

	it('resolves LID chats to their saved contact name and phone number', async () => {
		const provider = new WppConnectProvider('account-test', {});
		(provider as any).client = {
			getPnLidEntry: jest.fn().mockResolvedValue({
				phoneNumber: { _serialized: '201000000000@c.us' },
				contact: { name: 'Ahmed', pushname: 'A' },
			}),
		};

		await expect(provider.resolveContactIdentity('96547291279610@lid')).resolves.toEqual({
			phoneNumber: '201000000000',
			name: 'Ahmed',
		});
	});

	it('passes quoted message ids when sending media replies', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendFile = jest.fn().mockResolvedValue({ id: 'provider-media-1' });
		(provider as any).client = { sendFile };

		await provider.sendMedia('201000000000@c.us', 'C:\\test\\photo.jpg', {
			fileName: 'photo.jpg',
			caption: 'reply',
			quotedProviderMessageId: 'quoted-message-1',
		});

		expect(sendFile).toHaveBeenCalledWith('201000000000@c.us', 'C:\\test\\photo.jpg', {
			filename: 'photo.jpg',
			caption: 'reply',
			quotedMsg: 'quoted-message-1',
			waitForAck: true,
		});
	});

	it('sends voice recordings with a valid data URL MIME type', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendPttFromBase64 = jest.fn().mockResolvedValue({ id: 'provider-voice-1' });
		const readFile = jest
			.spyOn(require('fs').promises, 'readFile')
			.mockResolvedValue(Buffer.from('voice-data'));
		jest
			.spyOn(provider as any, 'convertVoiceToOgg')
			.mockResolvedValue('C:\\test\\voice-converted.ogg');
		(provider as any).client = { sendPttFromBase64 };

		try {
			await provider.sendMedia('201000000000@c.us', 'C:\\test\\voice.webm', {
				fileName: 'voice.webm',
				isVoice: true,
				mimeType: 'audio/webm; codecs=opus',
			});
		} finally {
			readFile.mockRestore();
		}

		expect(sendPttFromBase64).toHaveBeenCalledWith(
			'201000000000@c.us',
			expect.stringMatching(/^data:audio\/ogg;base64,/),
			'voice.ogg',
			'',
			undefined,
			undefined,
			true,
		);
	});

	it('retries sendText against a resolved lid when c.us fails', async () => {
		const provider = new WppConnectProvider('account-test', {});
		const sendText = jest
			.fn()
			.mockRejectedValueOnce(new Error('No LID for user'))
			.mockResolvedValueOnce({ id: { _serialized: 'true_123@lid_ABC' } });
		const getPnLidEntry = jest.fn().mockResolvedValue({
			lid: { _serialized: '123@lid' },
			phoneNumber: '201000000000',
		});
		(provider as any).client = { sendText, getPnLidEntry };

		const result = await provider.sendText('201000000000@c.us', 'hello');
		expect(getPnLidEntry).toHaveBeenCalled();
		expect(sendText).toHaveBeenCalled();
		expect(result?.id?._serialized || result?.id).toBeTruthy();
	});
});
